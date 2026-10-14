import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type PassAccessDecision } from '../../../passes/domain/pass-access';
import { type BookingView } from './booking.repository';

/** Quién es la persona y si el bono le deja entrar; `photoKey` lo firma quien lo presenta. */
export interface ScannedClientAccess {
  readonly clientMembershipId: string;
  readonly clientFullName: string;
  readonly photoKey: string | null;
  readonly access: PassAccessDecision;
}

export type CheckInOutcome =
  | (ScannedClientAccess & {
      readonly kind: 'checked_in' | 'already_checked_in';
      readonly booking: BookingView;
      readonly checkedInAt: Date;
    })
  /** No se ha registrado nada: sin permiso de acceso, o con él pero sin cita confirmada ahora. */
  | (ScannedClientAccess & { readonly kind: 'not_checked_in' })
  /** La membresía del código no es una clienta activa de este centro. */
  | { readonly kind: 'invalid_client' };

export interface CheckInRepository {
  /**
   * Decide si la clienta puede entrar con su bono y, solo si puede, registra su llegada en la cita
   * confirmada de ahora (el personal solo en las clases que atiende; administración en cualquiera).
   * Repetirlo devuelve la misma llegada.
   */
  checkInClient(
    actor: ActorContext,
    command: { clientMembershipId: string; now: Date },
  ): Promise<CheckInOutcome>;
}

export const CHECK_IN_REPOSITORY = Symbol('CHECK_IN_REPOSITORY');
