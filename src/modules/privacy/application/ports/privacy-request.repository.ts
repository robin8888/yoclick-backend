import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import {
  type PrivacyRequestKindName,
  type PrivacyRequestOutcome,
} from '../../domain/privacy-request-rules';

export interface PrivacyRequestView {
  readonly id: string;
  readonly clientMembershipId: string;
  readonly clientName: string;
  readonly kind: PrivacyRequestKindName;
  readonly status: 'open' | 'completed' | 'rejected';
  readonly message: string | null;
  readonly dueAt: Date;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolutionNote: string | null;
}

export interface NewPrivacyRequest {
  readonly id: string;
  readonly kind: PrivacyRequestKindName;
  readonly message: string | null;
  readonly dueAt: Date;
}

export type CreatePrivacyRequestOutcome =
  | { readonly kind: 'created'; readonly request: PrivacyRequestView }
  /** Ya tiene una solicitud abierta de ese mismo derecho. */
  | { readonly kind: 'already_open' };

export type ResolvePrivacyRequestOutcome =
  | { readonly kind: 'resolved'; readonly request: PrivacyRequestView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'already_resolved' };

/** Todo lo que este centro guarda de una persona (RGPD art. 15). */
export interface ClientDataExport {
  readonly exportedAt: Date;
  readonly person: {
    readonly fullName: string;
    readonly email: string;
    readonly phone: string | null;
    readonly birthDate: string | null;
  };
  readonly membership: {
    readonly status: string;
    readonly joinedAt: Date;
    readonly level: string | null;
    readonly groupName: string | null;
  };
  readonly bookings: readonly {
    readonly serviceName: string;
    readonly startsAt: Date;
    readonly status: string;
    readonly checkedInAt: Date | null;
    readonly cancelledAt: Date | null;
  }[];
  readonly routines: readonly { readonly name: string; readonly assignedAt: Date }[];
  readonly privacyRequests: readonly {
    readonly kind: string;
    readonly status: string;
    readonly createdAt: Date;
    readonly resolvedAt: Date | null;
  }[];
}

export interface PrivacyRequestRepository {
  create(actor: ActorContext, request: NewPrivacyRequest): Promise<CreatePrivacyRequestOutcome>;
  listMine(actor: ActorContext): Promise<PrivacyRequestView[]>;
  /** Las abiertas primero (la que vence antes, arriba) y luego las resueltas, la más reciente arriba. */
  listForCenter(actor: ActorContext): Promise<PrivacyRequestView[]>;
  resolve(
    actor: ActorContext,
    request: { requestId: string; outcome: PrivacyRequestOutcome; note: string | null },
  ): Promise<ResolvePrivacyRequestOutcome>;
  exportClientData(
    actor: ActorContext,
    clientMembershipId: string,
  ): Promise<ClientDataExport | null>;
}

export const PRIVACY_REQUEST_REPOSITORY = Symbol('PRIVACY_REQUEST_REPOSITORY');
