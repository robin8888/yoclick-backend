import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';
import { RECOVERY_CODE_COUNT } from '../../domain/recovery-code';
import {
  hasExactlyOneSecondFactorCode,
  recoveryCodeFieldSchema,
  totpCodeSchema,
} from './mfa-verify-request.dto';

const MAX_PASSWORD_LENGTH_ACCEPTED = 256;

export class MfaSetupRequestDto extends createZodDto(
  z.strictObject({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED) }),
) {}

export class MfaSetupResponseDto extends createZodDto(
  z.strictObject({
    /** Base32, para quien prefiera teclearlo. Se enseña una sola vez. */
    secret: z.string(),
    /** `otpauth://` para convertirlo en QR. */
    provisioningUri: z.string(),
  }),
) {}

export class MfaConfirmRequestDto extends createZodDto(z.strictObject({ code: totpCodeSchema })) {}

export class MfaConfirmResponseDto extends createZodDto(
  z.strictObject({
    /** Diez códigos de un solo uso. Se enseñan UNA vez: hay que guardarlos. */
    recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
    /** Sesión nueva ya verificada con segundo factor: la app la usa en lugar de volver a iniciar sesión. */
    session: z.strictObject({
      accessToken: z.string(),
      accessTokenExpiresAt: z.iso.datetime(),
      refreshToken: z.string(),
      refreshTokenExpiresAt: z.iso.datetime(),
    }),
  }),
) {}

export class MfaStatusResponseDto extends createZodDto(
  z.strictObject({
    isEnabled: z.boolean(),
    /** El método principal activo (`totp` = app de autenticación, `email` = código por correo). */
    method: z.enum(['totp', 'email']).nullable(),
    /** Correo enmascarado (`a***@dominio.com`) al que llegarían los códigos por correo. */
    emailHint: z.string().nullable(),
    recoveryCodesRemaining: z.number().int().min(0),
  }),
) {}

/** Se ha enviado un código al correo: la app enseña a qué buzón y hasta cuándo vale. */
export class EmailCodeSentResponseDto extends createZodDto(
  z.strictObject({
    emailHint: z.string(),
    /** Instante en que caduca el código (10 minutos tras el envío). */
    codeExpiresAt: z.iso.datetime(),
  }),
) {}

/** Contraseña más una prueba del propio segundo factor: el código de la app o uno de recuperación. */
export class MfaProofRequestDto extends createZodDto(
  z
    .strictObject({
      password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
      code: totpCodeSchema.optional(),
      emailCode: totpCodeSchema.optional(),
      recoveryCode: recoveryCodeFieldSchema.optional(),
    })
    .refine(hasExactlyOneSecondFactorCode, 'send exactly one of code, emailCode or recoveryCode'),
) {}

export class RegeneratedRecoveryCodesResponseDto extends createZodDto(
  z.strictObject({ recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT) }),
) {}
