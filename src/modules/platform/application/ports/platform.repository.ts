import { type PlatformActorContext } from '../../../../shared/auth/authenticated-request';
import { type Page } from '../../../../shared/pagination/build-page';
import { type MonthlyCount } from '../../domain/monthly-series';
import { type PlanPriceChanges } from '../../domain/plan-rules';

export const PLATFORM_REPOSITORY = Symbol('PLATFORM_REPOSITORY');
export const PLATFORM_PLAN_REPOSITORY = Symbol('PLATFORM_PLAN_REPOSITORY');

export type CenterStatus = 'trial' | 'active' | 'past_due' | 'suspended';

/** Cifras agregadas de toda la plataforma. Nunca lleva nombres ni datos de personas. */
export interface PlatformOverview {
  readonly generatedAt: Date;
  readonly centers: {
    readonly total: number;
    readonly byStatus: Readonly<Record<CenterStatus, number>>;
    readonly newLast30Days: number;
    readonly trialsEndingWithin7Days: number;
  };
  readonly people: { readonly activeClients: number; readonly activeTeamMembers: number };
  readonly bookingsLast30Days: number;
  readonly monthly: {
    readonly newCenters: readonly MonthlyCount[];
    readonly bookings: readonly MonthlyCount[];
  };
  readonly centersBySector: readonly { readonly sectorId: string; readonly count: number }[];
}

/** Un centro con sus cifras de uso: negocio y cantidades, nunca las personas. */
export interface PlatformCenterSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly sectorId: string;
  readonly city: string | null;
  /** Ruta del logo del centro; `null` si no ha subido ninguno. */
  readonly logoUrl: string | null;
  readonly status: CenterStatus;
  /** Plan contratado (`basic`, `pro`, `premium`); durante la prueba es Pro. */
  readonly planId: string;
  readonly createdAt: Date;
  readonly trialEndsAt: Date | null;
  /** Tope de clientes activos del plan; `null` = sin tope. */
  readonly maxClients: number | null;
  readonly activeClientCount: number;
  readonly teamMemberCount: number;
  readonly bookingsLast30Days: number;
  readonly lastBookingAt: Date | null;
}

export interface PlatformCenterDetail extends PlatformCenterSummary {
  readonly timezone: string;
  readonly disabledModules: readonly string[];
  readonly stripeChargesEnabled: boolean;
  readonly documentStorageLimitBytes: number;
  readonly videoStorageLimitBytes: number | null;
  readonly photoStorageLimitBytes: number;
}

export interface CenterListQuery {
  readonly status?: CenterStatus | undefined;
  readonly sectorId?: string | undefined;
  readonly search?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/** Lo que la plataforma puede cambiar de un centro. */
export interface CenterChanges {
  readonly status?: CenterStatus | undefined;
  readonly trialEndsAt?: Date | null | undefined;
  readonly maxClients?: number | null | undefined;
  /** Al cambiar de plan se copian al centro los límites del nuevo plan. */
  readonly planId?: string | undefined;
}

export interface AuditEntryInput {
  readonly action: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface PlatformAuditEntry {
  readonly id: string;
  readonly action: string;
  readonly centerId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface AuditListQuery {
  readonly centerId?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/** Un cambio de la plataforma sobre un centro, con su rastro de auditoría. */
export interface CenterUpdate {
  readonly actor: PlatformActorContext;
  readonly centerId: string;
  readonly changes: CenterChanges;
  readonly auditEntries: readonly AuditEntryInput[];
}

export interface PlatformRepository {
  getOverview(actor: PlatformActorContext, now: Date): Promise<PlatformOverview>;
  listCenters(
    actor: PlatformActorContext,
    query: CenterListQuery,
    now: Date,
  ): Promise<Page<PlatformCenterSummary>>;
  findCenter(
    actor: PlatformActorContext,
    centerId: string,
    now: Date,
  ): Promise<PlatformCenterDetail | null>;
  /** Aplica los cambios y deja su rastro de auditoría en la misma transacción. */
  updateCenter(update: CenterUpdate): Promise<boolean>;
  listAuditEntries(
    actor: PlatformActorContext,
    query: AuditListQuery,
  ): Promise<Page<PlatformAuditEntry>>;
}

/** Un plan con su precio, sus límites y cuántos centros lo tienen. */
export interface PlatformPlanSummary {
  readonly id: string;
  readonly name: string;
  readonly monthlyPriceCents: number;
  readonly annualMonthlyPriceCents: number;
  readonly setupFeeCents: number;
  readonly maxClients: number | null;
  readonly documentStorageLimitBytes: number;
  readonly videoStorageLimitBytes: number | null;
  readonly centerCountByStatus: Readonly<Record<CenterStatus, number>>;
}

export interface PlanPriceUpdate {
  readonly actor: PlatformActorContext;
  readonly planId: string;
  readonly changes: PlanPriceChanges;
  readonly auditEntries: readonly AuditEntryInput[];
}

export interface PlatformPlanRepository {
  listPlans(actor: PlatformActorContext): Promise<PlatformPlanSummary[]>;
  findPlan(actor: PlatformActorContext, planId: string): Promise<PlatformPlanSummary | null>;
  /** Cambia los importes y deja su rastro de auditoría en la misma transacción. */
  updatePlanPrices(update: PlanPriceUpdate): Promise<boolean>;
}
