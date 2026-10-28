import { type PlatformActorContext } from '../../../../shared/auth/authenticated-request';
import { type Page } from '../../../../shared/pagination/build-page';
import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type VoiceCallOutcomeName } from '../../domain/call-outcome';
import { type VoiceOveragePolicyName } from '../../domain/usage-minutes';
import { type VoiceAgentConfigView, type VoiceForwardingModeName } from './voice-call.repository';

export interface VoiceAddonPlanView {
  readonly planId: string;
  readonly monthlyPriceCents: number;
  readonly includedMinutes: number;
  readonly overageCentsPerMinute: number;
}

export interface VoiceSubscriptionView {
  readonly status: 'active' | 'paused' | 'cancelled';
  readonly includedMinutes: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export interface VoiceOverview {
  readonly planId: string;
  readonly isEnabled: boolean;
  readonly centerPhone: string | null;
  readonly line: {
    readonly phoneNumber: string;
    readonly provider: string;
    readonly isActive: boolean;
  } | null;
  readonly subscription: VoiceSubscriptionView | null;
  readonly config: VoiceAgentConfigView | null;
  readonly addonPlan: VoiceAddonPlanView | null;
}

export interface VoiceConfigPatch {
  readonly greeting?: string | null | undefined;
  readonly assistantName?: string | null | undefined;
  readonly voice?: string | null | undefined;
  readonly forwardingMode?: VoiceForwardingModeName | undefined;
  readonly humanTransferPhone?: string | null | undefined;
  readonly legalNotice?: string | null | undefined;
  readonly transcriptRetentionDays?: number | undefined;
  readonly overagePolicy?: VoiceOveragePolicyName | undefined;
}

export interface VoiceCallListItem {
  readonly id: string;
  readonly callerPhone: string;
  readonly callerName: string | null;
  readonly startedAt: Date;
  readonly durationSeconds: number | null;
  readonly outcome: VoiceCallOutcomeName | null;
  readonly summary: string | null;
  readonly estimatedCostCents: number | null;
  readonly hasTranscript: boolean;
}

export interface VoiceUsageView {
  readonly periodStart: Date;
  readonly usedMinutes: number;
  readonly includedMinutes: number;
}

export type VoiceEnableOutcome =
  | { readonly kind: 'changed' }
  | { readonly kind: 'no_subscription' }
  | { readonly kind: 'no_phone_line' };

export interface VoiceProvisioning {
  readonly centerId: string;
  readonly bridgeNumber: string;
  readonly provider: 'vapi' | 'fake';
  /** Sin él se toman los minutos del plan del centro (`voice_addon_plans`). */
  readonly includedMinutes?: number | undefined;
  /**
   * Si el add-on viene de la suscripción de Stripe del centro: las líneas que se le añadieron y el periodo de
   * cobro. Sin esto (centro piloto, sin cobro) el periodo es un mes desde el alta.
   */
  readonly billing?: VoiceProvisioningBilling | undefined;
}

export interface VoiceProvisioningBilling {
  readonly itemId: string;
  readonly overageItemId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/** Lo que hace falta para añadir el add-on a la suscripción de Stripe que el centro ya tiene. */
export interface VoiceProvisioningBillingFacts {
  readonly planId: string;
  /** `annual` si el centro paga el año entero: su suscripción es anual y el add-on es mensual. */
  readonly billingPeriod: 'monthly' | 'annual' | null;
  readonly stripeSubscriptionId: string | null;
  readonly taxRateId: string | null;
  readonly monthlyPriceId: string | null;
  readonly overagePriceId: string | null;
}

/** Las líneas del add-on en Stripe de un centro, para quitarlas al darlo de baja. */
export interface VoiceDeprovisioningFacts {
  readonly itemId: string | null;
  readonly overageItemId: string | null;
}

export interface VoiceAdminRepository {
  getOverview(actor: ActorContext): Promise<VoiceOverview | null>;
  saveConfig(actor: ActorContext, patch: VoiceConfigPatch): Promise<VoiceAgentConfigView>;
  /** Con `true` exige suscripción en vigor y número puente; con `false` apaga sin más. */
  setEnabled(actor: ActorContext, isEnabled: boolean): Promise<VoiceEnableOutcome>;
  listCalls(
    actor: ActorContext,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<Page<VoiceCallListItem>>;
  getUsage(actor: ActorContext, now: Date): Promise<VoiceUsageView | null>;
  /** Devuelve el código de la propia persona, sorteándolo la primera vez. */
  ensureStudentCode(actor: ActorContext): Promise<string | null>;
  /** Alta de un centro en el add-on desde la plataforma; `false` si el centro o su plan no existen. */
  provisionCenter(
    actor: PlatformActorContext,
    provisioning: VoiceProvisioning,
    now: Date,
  ): Promise<boolean>;
  /** Lo que hace falta para facturar el add-on de un centro; `null` si el centro no existe. */
  readProvisioningBillingFacts(
    actor: PlatformActorContext,
    centerId: string,
  ): Promise<VoiceProvisioningBillingFacts | null>;
  /** Las líneas del add-on en Stripe, para quitarlas antes de dar de baja; `null` si no tiene add-on. */
  readDeprovisioningFacts(
    actor: PlatformActorContext,
    centerId: string,
  ): Promise<VoiceDeprovisioningFacts | null>;
  /** Da de baja el add-on: suscripción cancelada, interruptor apagado y líneas de Stripe olvidadas. */
  deprovisionCenter(actor: PlatformActorContext, centerId: string): Promise<boolean>;
  /** Borra las transcripciones más antiguas que la retención de cada centro; devuelve cuántas. */
  clearExpiredTranscripts(now: Date): Promise<number>;
}

export const VOICE_ADMIN_REPOSITORY = Symbol('VOICE_ADMIN_REPOSITORY');
