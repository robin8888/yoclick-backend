import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { type Environment } from '../../../shared/config/environment.schema';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { MILLISECONDS_PER_DAY, MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { type BillingPeriod } from './ports/billing-gateway';

export const PLAN_PAYMENT_LINK_LIFETIME_DAYS = 14;
const SIGNING_ALGORITHM = 'HS256';
const LINK_LIFETIME_SECONDS =
  (PLAN_PAYMENT_LINK_LIFETIME_DAYS * MILLISECONDS_PER_DAY) / MILLISECONDS_PER_SECOND;
/** Un token firmado con la misma clave para otra cosa nunca sirve como enlace de pago. */
const PLAN_PAYMENT_LINK_AUDIENCE = 'yoclick-plan-payment-link';
const PAY_PATH = '/v1/billing/pay';

export interface PlanPaymentLinkClaims {
  readonly centerId: string;
  readonly planId: 'basic' | 'pro' | 'premium';
  readonly period: BillingPeriod;
}

const claimsSchema = z.object({
  centerId: z.uuid(),
  planId: z.enum(['basic', 'pro', 'premium']),
  period: z.enum(['monthly', 'annual']),
});

/**
 * Los enlaces de pago de los correos: un token firmado (HS256, jose) con la clave secreta de la API. El token
 * solo dice «este centro quiere contratar este plan», así que quien lo tenga solo puede abrir una página de
 * pago de Stripe para ese centro; la sesión de Stripe se crea al abrir el enlace, no al enviar el correo.
 */
@Injectable()
export class PlanPaymentLinkService {
  private readonly signingKey: Uint8Array;
  private readonly publicApiUrl: string;

  constructor(configService: ConfigService<Environment, true>) {
    // El esquema de entorno ya exige que el pepper tenga al menos 32 bytes.
    const pepperBase64 = configService.get('AUTH_CODE_PEPPER_BASE64', { infer: true });
    this.signingKey = Buffer.from(pepperBase64, 'base64');
    this.publicApiUrl = configService.get('PUBLIC_API_URL', { infer: true });
  }

  async buildUrl(claims: PlanPaymentLinkClaims, now: Date = new Date()): Promise<string> {
    const issuedAtSeconds = Math.floor(now.getTime() / MILLISECONDS_PER_SECOND);
    const token = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: SIGNING_ALGORITHM })
      .setAudience(PLAN_PAYMENT_LINK_AUDIENCE)
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(issuedAtSeconds + LINK_LIFETIME_SECONDS)
      .sign(this.signingKey);
    const url = new URL(PAY_PATH, this.publicApiUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  /** Cualquier fallo (caducado, firma mala, otra audiencia, datos raros) responde igual: no se explica cuál. */
  async verify(token: string, now: Date = new Date()): Promise<PlanPaymentLinkClaims> {
    try {
      const { payload } = await jwtVerify(token, this.signingKey, {
        algorithms: [SIGNING_ALGORITHM],
        audience: PLAN_PAYMENT_LINK_AUDIENCE,
        currentDate: now,
      });
      return claimsSchema.parse(payload);
    } catch {
      throw new DomainError('PAYMENT_LINK_INVALID', HTTP_STATUS.badRequest);
    }
  }
}
