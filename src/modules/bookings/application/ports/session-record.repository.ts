import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type BookingView } from './booking.repository';

export type StartSessionOutcome =
  | { readonly kind: 'started'; readonly booking: BookingView }
  /** Ya estaba iniciada: se devuelve tal cual, sin tocar la hora de inicio. */
  | { readonly kind: 'already_started'; readonly booking: BookingView }
  /** No existe, es de otro centro o no es de quien lo pide (se responde 404). */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_startable' }
  | { readonly kind: 'session_already_open' };

export type EndSessionOutcome =
  | { readonly kind: 'ended'; readonly booking: BookingView }
  | { readonly kind: 'already_ended'; readonly booking: BookingView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_started' };

export interface SessionRecordEntry {
  readonly booking: BookingView;
  readonly client: { readonly membershipId: string; readonly fullName: string };
  readonly notes: string | null;
}

export interface SessionRecordsQuery {
  readonly fromDate: string;
  readonly toDate: string;
  readonly staffMembershipId: string | null;
  readonly now: Date;
}

export interface SessionRecordsFound {
  readonly timeZone: string;
  readonly entries: readonly SessionRecordEntry[];
}

export interface SessionRecordRepository {
  /**
   * Abre la clase en una transacción que serializa a la misma persona del equipo: por muchas
   * peticiones simultáneas, nunca quedan dos clases abiertas a la vez.
   */
  startSession(
    actor: ActorContext,
    command: { bookingId: string; now: Date },
  ): Promise<StartSessionOutcome>;
  endSession(
    actor: ActorContext,
    command: { bookingId: string; now: Date; notes: string | null },
  ): Promise<EndSessionOutcome>;
  listSessionRecords(actor: ActorContext, query: SessionRecordsQuery): Promise<SessionRecordsFound>;
}

export const SESSION_RECORD_REPOSITORY = Symbol('SESSION_RECORD_REPOSITORY');
