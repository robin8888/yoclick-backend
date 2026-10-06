import { type ActorContext } from '../../../../shared/tenancy/actor-context';

export interface JoinCounts {
  readonly qr: number;
  readonly link: number;
  readonly code: number;
  readonly search: number;
  /** Todas las personas que se han unido como cliente en el periodo, vengan de donde vengan. */
  readonly total: number;
}

export interface JoinStats extends JoinCounts {
  /** Mes natural en la zona horaria del centro, `AAAA-MM`. */
  readonly month: string;
}

export type ReplaceJoinCodeOutcome = 'replaced' | 'code_taken';

export interface CenterSharingRepository {
  /** Quienes se unieron como cliente este mes (en la zona horaria del centro), por origen. */
  countJoinsThisMonth(actor: ActorContext, now: Date): Promise<JoinStats>;
  /** Cambia el código de unión; `code_taken` si otro centro ya lo tiene. */
  replaceJoinCode(actor: ActorContext, newJoinCode: string): Promise<ReplaceJoinCodeOutcome>;
}

export const CENTER_SHARING_REPOSITORY = Symbol('CENTER_SHARING_REPOSITORY');
