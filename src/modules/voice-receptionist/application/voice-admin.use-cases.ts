import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_GATEWAY,
  type BillingGateway,
} from '../../billing/application/ports/billing-gateway';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type Page } from '../../../shared/pagination/build-page';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  arePhoneNumbersEqual,
  isE164PhoneNumber,
  normalizePhoneNumber,
} from '../domain/phone-number';
import { resolveVoiceCapabilities, type VoiceCapabilities } from '../domain/voice-capabilities';
import { summarizeVoiceUsage, type VoiceUsageSummary } from '../domain/usage-minutes';
import {
  VOICE_ADMIN_REPOSITORY,
  type VoiceAdminRepository,
  type VoiceCallListItem,
  type VoiceConfigPatch,
  type VoiceOverview,
  type VoiceProvisioning,
} from './ports/voice-admin.repository';
import { type VoiceAgentConfigView } from './ports/voice-call.repository';

export interface VoiceOverviewView extends VoiceOverview {
  readonly capabilities: VoiceCapabilities;
  readonly usage: VoiceUsageSummary | null;
}

/** El estado del contestador para el panel: contratado o no, número puente, ajustes, capacidades y consumo. */
@Injectable()
export class GetVoiceOverviewUseCase {
  constructor(@Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository) {}

  async execute(actor: ActorContext, now: Date): Promise<VoiceOverviewView> {
    const overview = await this.admin.getOverview(actor);
    if (overview === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const usage = await this.admin.getUsage(actor, now);
    return {
      ...overview,
      capabilities: resolveVoiceCapabilities(overview.planId),
      usage: usage === null ? null : summarizeVoiceUsage(usage),
    };
  }
}

const PERSONALIZATION_FIELDS = ['greeting', 'assistantName', 'voice'] as const;

/**
 * Cambia los ajustes del asistente. Saludo, nombre y voz propios son del plan Premium; el teléfono para pasar la
 * llamada tiene que ser un móvil o fijo de una persona, nunca el del centro ni el número puente (sería un bucle).
 */
@Injectable()
export class UpdateVoiceConfigUseCase {
  constructor(@Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository) {}

  async execute(actor: ActorContext, patch: VoiceConfigPatch): Promise<VoiceAgentConfigView> {
    const overview = await this.admin.getOverview(actor);
    if (overview === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (overview.subscription === null) {
      throw new DomainError('VOICE_ADDON_NOT_CONTRACTED', HTTP_STATUS.paymentRequired);
    }
    this.assertPersonalizationIsIncluded(overview, patch);
    const normalizedPatch = this.normalizeTransferPhone(overview, patch);
    return this.admin.saveConfig(actor, normalizedPatch);
  }

  private assertPersonalizationIsIncluded(overview: VoiceOverview, patch: VoiceConfigPatch): void {
    const isPersonalizing = PERSONALIZATION_FIELDS.some((field) => patch[field] !== undefined);
    if (isPersonalizing && !resolveVoiceCapabilities(overview.planId).canCustomizeAssistant) {
      throw new DomainError('PLAN_FEATURE_NOT_INCLUDED', HTTP_STATUS.paymentRequired);
    }
  }

  private normalizeTransferPhone(
    overview: VoiceOverview,
    patch: VoiceConfigPatch,
  ): VoiceConfigPatch {
    if (patch.humanTransferPhone === undefined || patch.humanTransferPhone === null) return patch;
    const transferPhone = normalizePhoneNumber(patch.humanTransferPhone);
    const isLoop =
      transferPhone === null ||
      !isE164PhoneNumber(transferPhone) ||
      (overview.centerPhone !== null &&
        arePhoneNumbersEqual(transferPhone, overview.centerPhone)) ||
      (overview.line !== null && transferPhone === overview.line.phoneNumber);
    if (transferPhone === null || isLoop) {
      throw new DomainError('VOICE_TRANSFER_PHONE_INVALID', HTTP_STATUS.unprocessableEntity);
    }
    return { ...patch, humanTransferPhone: transferPhone };
  }
}

/** Activar o apagar el contestador. Con él apagado el centro funciona exactamente igual que sin él. */
@Injectable()
export class SetVoiceEnabledUseCase {
  constructor(@Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository) {}

  async execute(actor: ActorContext, isEnabled: boolean): Promise<void> {
    const outcome = await this.admin.setEnabled(actor, isEnabled);
    if (outcome.kind === 'no_subscription') {
      throw new DomainError('VOICE_ADDON_NOT_CONTRACTED', HTTP_STATUS.paymentRequired);
    }
    if (outcome.kind === 'no_phone_line') {
      throw new DomainError('VOICE_LINE_NOT_ASSIGNED', HTTP_STATUS.conflict);
    }
  }
}

@Injectable()
export class ListVoiceCallsUseCase {
  constructor(@Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository) {}

  async execute(
    actor: ActorContext,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<Page<VoiceCallListItem>> {
    return this.admin.listCalls(actor, query);
  }
}

/** El código de la propia persona para decirlo por teléfono; se sortea la primera vez que lo pide. */
@Injectable()
export class GetMyStudentCodeUseCase {
  constructor(@Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository) {}

  async execute(actor: ActorContext): Promise<string> {
    const code = await this.admin.ensureStudentCode(actor);
    if (code === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return code;
  }
}

export interface ProvisionVoiceCommand extends Omit<VoiceProvisioning, 'billing'> {
  /** Añade el add-on a la suscripción de Stripe del centro; sin él es un centro piloto, sin cobro. */
  readonly shouldBillWithStripe: boolean;
}

/**
 * Alta de un centro en el add-on desde la plataforma. Con cobro, el add-on se añade como líneas de la
 * suscripción que el centro ya tiene en Stripe (la fija del escalón de su plan y la del minuto de exceso) y
 * el periodo de cobro del add-on es el de esa suscripción. Primero Stripe y luego la base de datos: si algo
 * falla a medias, repetir el alta reutiliza las líneas ya puestas y no cobra dos veces.
 */
@Injectable()
export class ProvisionVoiceReceptionistUseCase {
  constructor(
    @Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
  ) {}

  async execute(
    actor: PlatformActorContext,
    command: ProvisionVoiceCommand,
    now: Date,
  ): Promise<void> {
    const bridgeNumber = normalizePhoneNumber(command.bridgeNumber);
    if (bridgeNumber === null) {
      throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.unprocessableEntity, [
        { path: 'bridgeNumber', code: 'invalid_phone' },
      ]);
    }
    const { shouldBillWithStripe, ...provisioning } = command;
    const billing = shouldBillWithStripe
      ? await this.attachToSubscription(actor, command.centerId)
      : undefined;
    const isProvisioned = await this.admin.provisionCenter(
      actor,
      { ...provisioning, bridgeNumber, billing },
      now,
    );
    if (!isProvisioned) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }

  private async attachToSubscription(
    actor: PlatformActorContext,
    centerId: string,
  ): Promise<VoiceProvisioning['billing']> {
    const facts = await this.admin.readProvisioningBillingFacts(actor, centerId);
    if (facts === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const { stripeSubscriptionId, taxRateId, monthlyPriceId, overagePriceId } = facts;
    // Las líneas del add-on son mensuales y Stripe no las deja convivir con una suscripción anual.
    if (facts.billingPeriod === 'annual') {
      throw new DomainError('VOICE_ADDON_ANNUAL_PLAN_NOT_SUPPORTED', HTTP_STATUS.conflict);
    }
    // Sin suscripción del centro o sin `billing:setup` hecho no hay dónde ni a qué precio añadir el add-on.
    if (
      stripeSubscriptionId === null ||
      taxRateId === null ||
      monthlyPriceId === null ||
      overagePriceId === null
    ) {
      throw new DomainError('VOICE_ADDON_BILLING_NOT_READY', HTTP_STATUS.conflict);
    }
    return this.gateway.attachVoiceAddon({
      subscriptionId: stripeSubscriptionId,
      monthlyPriceId,
      overagePriceId,
      taxRateId,
    });
  }
}

/** Baja del add-on desde la plataforma: se quitan sus líneas de la suscripción y el bot deja de atender. */
@Injectable()
export class DeprovisionVoiceReceptionistUseCase {
  constructor(
    @Inject(VOICE_ADMIN_REPOSITORY) private readonly admin: VoiceAdminRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
  ) {}

  async execute(actor: PlatformActorContext, centerId: string): Promise<void> {
    const facts = await this.admin.readDeprovisioningFacts(actor, centerId);
    if (facts === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (facts.itemId !== null) {
      await this.gateway.detachVoiceAddon({
        itemId: facts.itemId,
        overageItemId: facts.overageItemId,
      });
    }
    await this.admin.deprovisionCenter(actor, centerId);
  }
}
