import {
  type ActorContext,
  type MembershipRoleName,
} from '../../../../shared/tenancy/actor-context';
import { type MessageReportReasonName } from '../../domain/chat-moderation-rules';

export type MessageReportStatusName = 'open' | 'reviewed';

/** A quién se quiere bloquear: solo hace falta saber quién es y qué rol tiene. */
export interface BlockTarget {
  readonly id: string;
  readonly role: MembershipRoleName;
}

export interface BlockedPersonView {
  readonly membershipId: string;
  readonly fullName: string;
  readonly role: MembershipRoleName;
  readonly photoKey: string | null;
  readonly blockedAt: Date;
}

/** Un mensaje que quien mira puede denunciar: lo que hace falta para decidir y para copiarlo en la denuncia. */
export interface ReportableMessage {
  readonly id: string;
  readonly senderMembershipId: string;
  readonly body: string | null;
  readonly attachmentName: string | null;
}

export interface NewMessageReport {
  readonly id: string;
  readonly message: ReportableMessage;
  readonly reason: MessageReportReasonName;
  readonly details: string | null;
}

export interface CreatedMessageReport {
  readonly reportId: string;
  readonly status: MessageReportStatusName;
  /** `false` si esa persona ya había denunciado el mensaje: no se duplica ni se vuelve a avisar. */
  readonly isNew: boolean;
}

/**
 * Lo que ve la administración de una denuncia. `reportedBody` es una COPIA del mensaje: es la única forma de
 * que el dueño lea algo de una conversación privada, y solo porque quien denuncia decidió compartirlo.
 */
export interface MessageReportView {
  readonly id: string;
  readonly reason: MessageReportReasonName;
  readonly details: string | null;
  readonly status: MessageReportStatusName;
  readonly reporterName: string;
  readonly reportedSenderName: string;
  readonly reportedBody: string | null;
  readonly reportedAttachmentName: string | null;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
}

export interface ChatModerationRepository {
  /** `null` si no existe, no está activa o es de otro centro. */
  findBlockTarget(actor: ActorContext, membershipId: string): Promise<BlockTarget | null>;
  listBlocks(actor: ActorContext): Promise<BlockedPersonView[]>;
  /** Idempotente: bloquear a quien ya está bloqueado devuelve el bloqueo que había. */
  addBlock(actor: ActorContext, blockedMembershipId: string): Promise<BlockedPersonView>;
  removeBlock(actor: ActorContext, blockedMembershipId: string): Promise<void>;
  /** `null` si la conversación o el mensaje no existen o no son de quien pregunta. */
  findReportableMessage(
    actor: ActorContext,
    request: { conversationId: string; messageId: string },
  ): Promise<ReportableMessage | null>;
  /** Guarda la denuncia y avisa a la administración, en la misma transacción. */
  createReport(actor: ActorContext, report: NewMessageReport): Promise<CreatedMessageReport>;
  listReports(
    actor: ActorContext,
    query: { status: MessageReportStatusName | null; limit: number },
  ): Promise<MessageReportView[]>;
  /** `null` si la denuncia no existe; revisar una ya revisada la deja como estaba. */
  reviewReport(
    actor: ActorContext,
    request: { reportId: string; reviewedAt: Date },
  ): Promise<MessageReportView | null>;
}

export const CHAT_MODERATION_REPOSITORY = Symbol('CHAT_MODERATION_REPOSITORY');
