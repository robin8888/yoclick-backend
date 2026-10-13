import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type PassStatusName } from '../../domain/pass-rules';

/** Un bono a la venta tal y como lo ve la app. */
export interface RateView {
  readonly id: string;
  readonly name: string;
  readonly sessionsCount: number;
  readonly validDays: number;
  readonly priceCents: number;
  /** Servicios en los que vale; vacío = todos. */
  readonly services: readonly { readonly id: string; readonly name: string }[];
}

export interface NewRate {
  readonly name: string;
  readonly sessionsCount: number;
  readonly validDays: number;
  readonly priceCents: number;
  readonly serviceIds: readonly string[];
}

export interface RatePatch {
  readonly name?: string | undefined;
  readonly sessionsCount?: number | undefined;
  readonly validDays?: number | undefined;
  readonly priceCents?: number | undefined;
  readonly serviceIds?: readonly string[] | undefined;
}

/** El bono de una persona: lo que compró, cuánto le queda y hasta cuándo. */
export interface PassView {
  readonly id: string;
  readonly name: string;
  readonly status: PassStatusName;
  readonly totalSessions: number;
  readonly remainingSessions: number;
  readonly priceCents: number;
  readonly services: readonly { readonly id: string; readonly name: string }[];
  readonly isRequestedByClient: boolean;
  readonly requestedAt: Date;
  readonly startsAt: Date | null;
  readonly expiresAt: Date | null;
  readonly client: { readonly membershipId: string; readonly fullName: string };
}

export type RateChangeOutcome =
  | { readonly kind: 'saved'; readonly rate: RateView }
  | { readonly kind: 'not_found' }
  /** Algún servicio indicado no existe en este centro. */
  | { readonly kind: 'service_not_found' }
  | { readonly kind: 'limit_reached' };

export type PassRequestOutcome =
  | { readonly kind: 'created'; readonly pass: PassView }
  | { readonly kind: 'rate_not_found' }
  | { readonly kind: 'client_not_found' }
  /** Ya tiene pedido ese bono y el centro aún no lo ha activado. */
  | { readonly kind: 'already_pending' };

export type PassDecisionOutcome =
  | { readonly kind: 'decided'; readonly pass: PassView }
  | { readonly kind: 'not_found' }
  /** Ya no estaba pendiente. */
  | { readonly kind: 'not_pending' };

export interface PassListQuery {
  readonly now: Date;
  /** `null` = los de todo el centro (solo el equipo); con valor, los de esa persona. */
  readonly clientMembershipId: string | null;
  readonly statuses: readonly PassStatusName[] | null;
}

export interface PassRepository {
  /** Bonos no archivados, por orden de creación. */
  listRates(actor: ActorContext): Promise<RateView[]>;
  createRate(actor: ActorContext, newRate: NewRate): Promise<RateChangeOutcome>;
  updateRate(actor: ActorContext, rateId: string, patch: RatePatch): Promise<RateChangeOutcome>;
  /** Archiva (no borra): los bonos ya vendidos conservan sus condiciones. `false` si no existe. */
  archiveRate(actor: ActorContext, rateId: string): Promise<boolean>;
  /** La persona pide el bono: queda pendiente hasta que el centro lo active al cobrarlo. */
  requestPass(actor: ActorContext, command: { rateId: string }): Promise<PassRequestOutcome>;
  /** El centro entrega el bono ya activo a esa persona. */
  assignPass(
    actor: ActorContext,
    command: { rateId: string; clientMembershipId: string; now: Date },
  ): Promise<PassRequestOutcome>;
  listPasses(actor: ActorContext, query: PassListQuery): Promise<PassView[]>;
  /** Activa (empieza a contar su caducidad) o rechaza un bono pendiente. */
  decidePass(
    actor: ActorContext,
    command: { passId: string; decision: 'activate' | 'reject'; now: Date },
  ): Promise<PassDecisionOutcome>;
}

export const PASS_REPOSITORY = Symbol('PASS_REPOSITORY');
