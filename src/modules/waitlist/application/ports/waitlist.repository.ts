import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import {
  type BookingView,
  type JoinGroupSessionOutcome,
} from '../../../bookings/application/ports/booking.repository';

/** Una persona en la espera de una clase llena, con la clase a la que espera. */
export interface WaitlistEntryView {
  readonly id: string;
  readonly status: 'waiting' | 'offered';
  readonly classSessionId: string;
  readonly createdAt: Date;
  /** Lugar en la cola (1 = la primera); `null` cuando ya se le ofreció la plaza. */
  readonly position: number | null;
  /** Hasta cuándo puede confirmar la plaza ofrecida; `null` mientras espera. */
  readonly offerExpiresAt: Date | null;
  readonly session: {
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly service: { readonly id: string; readonly name: string };
  };
}

/** Quién espera una clase, tal como lo ve el personal del centro. */
export interface SessionWaitlistPersonView {
  readonly id: string;
  readonly status: 'waiting' | 'offered';
  readonly createdAt: Date;
  /** Lugar en la cola (1 = la primera); `null` cuando ya se le ofreció la plaza. */
  readonly position: number | null;
  readonly offerExpiresAt: Date | null;
  readonly client: { readonly membershipId: string; readonly fullName: string };
}

export type JoinWaitlistOutcome =
  | { readonly kind: 'joined'; readonly entry: WaitlistEntryView }
  /** No existe, no es grupal, está cancelada o ya empezó. */
  | { readonly kind: 'session_not_found' }
  /** Aún quedan plazas: se reserva directamente. */
  | { readonly kind: 'session_has_seats' }
  | { readonly kind: 'already_booked' }
  | { readonly kind: 'already_waiting' };

export type ConfirmOfferOutcome =
  | { readonly kind: 'confirmed'; readonly booking: BookingView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'offer_expired' }
  /** La reserva no se pudo hacer (bono sin clases, otra cita a esa hora…): la oferta sigue en pie. */
  | {
      readonly kind: 'refused';
      readonly reason: Exclude<JoinGroupSessionOutcome['kind'], 'created'>;
    };

export interface WaitlistRepository {
  join(
    actor: ActorContext,
    command: { classSessionId: string; now: Date },
  ): Promise<JoinWaitlistOutcome>;
  /** Sale de la espera. Devuelve si había algo que quitar y si tenía una plaza ofrecida (que hay que pasar). */
  leave(
    actor: ActorContext,
    command: { entryId: string },
  ): Promise<{ readonly wasFound: boolean; readonly hadOffer: boolean }>;
  /** El personal quita a alguien de la espera de una clase. Mismo resultado que `leave`. */
  removeFromSession(
    actor: ActorContext,
    command: { entryId: string; classSessionId: string },
  ): Promise<{ readonly wasFound: boolean; readonly hadOffer: boolean }>;
  listMine(actor: ActorContext, query: { now: Date }): Promise<WaitlistEntryView[]>;
  /** Quien espera una clase: primero las plazas ofrecidas y luego la cola por orden de llegada. */
  listForSession(
    actor: ActorContext,
    query: { classSessionId: string; now: Date },
  ): Promise<SessionWaitlistPersonView[]>;
  confirm(
    actor: ActorContext,
    command: { entryId: string; now: Date },
  ): Promise<ConfirmOfferOutcome>;
  /**
   * Revisa las clases del centro con gente esperando: caduca las ofertas vencidas y ofrece las plazas
   * libres por orden de llegada. Es idempotente.
   */
  advanceCenter(actor: ActorContext, command: { now: Date }): Promise<void>;
  /** Centros con alguna oferta vencida sin atender. */
  findCentersWithExpiredOffers(query: { now: Date }): Promise<string[]>;
}

export const WAITLIST_REPOSITORY = Symbol('WAITLIST_REPOSITORY');
