import { type MembershipRoleName } from '../../../shared/tenancy/actor-context';

export const MESSAGE_REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const;
export type MessageReportReasonName = (typeof MESSAGE_REPORT_REASONS)[number];

export const MAX_REPORT_DETAILS_LENGTH = 500;
export const MAX_MESSAGE_REPORTS_PER_PAGE = 100;
export const DEFAULT_MESSAGE_REPORTS_PAGE_SIZE = 50;

export type ChatModerationDecision =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'denied'; readonly code: 'CHAT_BLOCK_NOT_ALLOWED' };

const ALLOWED: ChatModerationDecision = { kind: 'allowed' };
const NOT_ALLOWED: ChatModerationDecision = { kind: 'denied', code: 'CHAT_BLOCK_NOT_ALLOWED' };

/**
 * Un bloqueo solo existe entre un alumno y un profesor, que son los dos lados de una conversación entre
 * personas. La administración habla en nombre del centro: ni bloquea ni se la puede bloquear, porque los
 * avisos del servicio (citas, bonos, impagos) tienen que seguir llegando. Si alguien abusa de la bandeja del
 * centro, se denuncia el mensaje y la administración decide sobre esa persona.
 */
export function decideBlock(input: {
  readonly actorRole: MembershipRoleName;
  readonly targetRole: MembershipRoleName;
  readonly isSamePerson: boolean;
}): ChatModerationDecision {
  if (input.isSamePerson) return NOT_ALLOWED;
  const isClientWithStaff =
    (input.actorRole === 'client' && input.targetRole === 'staff') ||
    (input.actorRole === 'staff' && input.targetRole === 'client');
  return isClientWithStaff ? ALLOWED : NOT_ALLOWED;
}

/** Quien escribió un mensaje no puede denunciarlo: denunciar es avisar de lo que ha hecho otra persona. */
export function canReportMessage(input: {
  readonly reporterMembershipId: string;
  readonly senderMembershipId: string;
}): boolean {
  return input.reporterMembershipId !== input.senderMembershipId;
}

/**
 * La otra parte de una conversación entre dos personas, vista desde quien mira; `null` si la conversación
 * es con el centro (no hay otra persona a la que aplicar un bloqueo).
 */
export function findOtherPerson(input: {
  readonly viewerMembershipId: string;
  readonly memberMembershipId: string;
  readonly counterpartMembershipId: string | null;
}): string | null {
  if (input.counterpartMembershipId === null) return null;
  return input.viewerMembershipId === input.memberMembershipId
    ? input.counterpartMembershipId
    : input.memberMembershipId;
}
