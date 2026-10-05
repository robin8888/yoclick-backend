import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type BookingView } from './booking.repository';

export type CheckInOutcome =
  | {
      readonly kind: 'checked_in' | 'already_checked_in';
      readonly booking: BookingView;
      readonly clientFullName: string;
      readonly checkedInAt: Date;
    }
  /** La membresía del código no es una clienta activa de este centro. */
  | { readonly kind: 'invalid_client' }
  | { readonly kind: 'no_booking' };

export interface CheckInRepository {
  /**
   * Registra la llegada de la clienta en su cita confirmada de ahora (el personal solo en las clases
   * que atiende; administración en cualquiera). Repetirlo devuelve la misma llegada.
   */
  checkInClient(
    actor: ActorContext,
    command: { clientMembershipId: string; now: Date },
  ): Promise<CheckInOutcome>;
}

export const CHECK_IN_REPOSITORY = Symbol('CHECK_IN_REPOSITORY');
