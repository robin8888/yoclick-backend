import {
  type JoinDecision,
  type MembershipRoleName,
  type MembershipStatusName,
} from '../../domain/join-decision';

/** Lo único de un centro que ve quien aún no pertenece a él. */
export interface PublicCenterSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly sectorId: string;
  readonly brandColor: string;
  readonly city: string | null;
}

export interface ListedCenter extends PublicCenterSummary {
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface JoinCommand {
  readonly userId: string;
  readonly centerId: string;
  /** Código normalizado que presentó la persona, si lo hizo. */
  readonly presentedJoinCode: string | null;
}

export interface JoinOutcome {
  readonly decision: JoinDecision;
  /** La membresía resultante; solo existe cuando la decisión deja a la persona dentro. */
  readonly membership: {
    readonly id: string;
    readonly centerId: string;
    readonly role: MembershipRoleName;
    readonly status: MembershipStatusName;
  } | null;
}

export interface JoinRepository {
  findCenterByJoinCode(joinCode: string): Promise<PublicCenterSummary | null>;
  listListedCenters(textQuery: string | null, limit: number): Promise<ListedCenter[]>;
  /** Decide y aplica la unión de forma atómica: el tope de clientes no se puede saltar con peticiones simultáneas. */
  joinAsClient(command: JoinCommand): Promise<JoinOutcome>;
}

export const JOIN_REPOSITORY = Symbol('JOIN_REPOSITORY');
