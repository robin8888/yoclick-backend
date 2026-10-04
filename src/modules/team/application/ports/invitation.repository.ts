import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type TeamMemberStatus, type TeamRoleName } from '../../domain/team-rules';

export interface NewInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: 'admin' | 'staff' | 'client';
  readonly tokenHash: string;
  readonly invitedByUserId: string;
  readonly expiresAt: Date;
}

export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: TeamRoleName;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** Lo que ve quien recibe el código antes de aceptar. */
export interface InvitationPreview {
  readonly role: TeamRoleName;
  readonly email: string;
  readonly expiresAt: Date;
  readonly center: {
    readonly id: string;
    readonly name: string;
    readonly sectorId: string;
    readonly brandColor: string;
  };
}

export type AcceptInvitationOutcome =
  | {
      readonly kind: 'accepted';
      readonly membership: {
        readonly id: string;
        readonly centerId: string;
        readonly role: TeamRoleName;
        readonly status: TeamMemberStatus;
      };
    }
  /** Código desconocido, caducado, usado, revocado o dirigido a otro correo: todo es lo mismo desde fuera. */
  | { readonly kind: 'invalid' }
  | { readonly kind: 'membership_blocked' }
  | { readonly kind: 'client_limit_reached' };

export interface AcceptInvitationCommand {
  readonly tokenHash: string;
  readonly userId: string;
  readonly now: Date;
}

export interface InvitationRepository {
  findCenterName(actor: ActorContext): Promise<string | null>;
  /** ¿Esa dirección ya es miembro (activo o bloqueado) del centro? */
  hasMemberWithEmail(actor: ActorContext, email: string): Promise<boolean>;
  /** Invitar de nuevo a la misma dirección anula la invitación pendiente anterior. */
  createReplacingPending(actor: ActorContext, invitation: NewInvitation, now: Date): Promise<void>;
  listPending(actor: ActorContext, now: Date): Promise<PendingInvitation[]>;
  revoke(actor: ActorContext, invitationId: string, now: Date): Promise<boolean>;
  findPreview(tokenHash: string, now: Date): Promise<InvitationPreview | null>;
  accept(command: AcceptInvitationCommand): Promise<AcceptInvitationOutcome>;
}

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');
