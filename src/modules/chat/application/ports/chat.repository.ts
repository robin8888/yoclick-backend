import {
  type ActorContext,
  type MembershipRoleName,
} from '../../../../shared/tenancy/actor-context';
import { type StartConversationFacts } from '../../domain/chat-rules';

export type AttachmentKind = 'image' | 'pdf';

/** Con quién se habla: el centro (su bandeja) o una persona. */
export type CounterpartView =
  | { readonly kind: 'center' }
  | {
      readonly kind: 'person';
      readonly membershipId: string;
      readonly fullName: string;
      readonly role: MembershipRoleName;
      readonly photoKey: string | null;
    };

export interface AttachmentView {
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly sizeBytes: number;
  readonly key: string;
}

export interface MessageView {
  readonly id: string;
  readonly conversationId: string;
  /** La persona de la conversación: de su lado están sus mensajes; del otro, los de quien la atiende. */
  readonly memberMembershipId: string;
  readonly senderMembershipId: string;
  readonly senderName: string;
  readonly body: string | null;
  readonly attachment: AttachmentView | null;
  readonly createdAt: Date;
}

export interface ConversationView {
  readonly id: string;
  readonly counterpart: CounterpartView;
  readonly lastMessage: MessageView | null;
  readonly lastMessageAt: Date;
  readonly unreadCount: number;
}

export interface ContactView {
  readonly membershipId: string;
  readonly fullName: string;
  readonly role: MembershipRoleName;
  readonly photoKey: string | null;
}

export interface ContactList {
  /** Si quien pregunta puede escribir «al centro» (todos menos la administración, que es el centro). */
  readonly canWriteToCenter: boolean;
  readonly people: readonly ContactView[];
}

/** Lo que hace falta saber para decidir si dos partes pueden hablar, y quién es quién. */
export interface StartConversationContext {
  readonly facts: StartConversationFacts;
  readonly memberMembershipId: string;
  readonly counterpartMembershipId: string | null;
}

export interface ConversationAccess {
  readonly conversationId: string;
  /** Si el alumno de la conversación es menor: no se le escribe hasta que haya tutores. */
  readonly isBlockedByMinor: boolean;
}

export interface NewMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly body: string | null;
  readonly attachment: AttachmentView | null;
  readonly sentAt: Date;
}

/** A quién se difunde: un grupo de clientes o la clase fija de «Gestión» (su grupo fijo). */
export type BroadcastTarget =
  | { readonly kind: 'group'; readonly groupId: string }
  | { readonly kind: 'series'; readonly seriesId: string };

export type GroupBroadcastOutcome =
  | { readonly kind: 'group_not_found' }
  | { readonly kind: 'sent'; readonly sentCount: number; readonly skippedMinorCount: number };

export interface ChatRepository {
  listConversations(actor: ActorContext): Promise<ConversationView[]>;
  listContacts(actor: ActorContext): Promise<ContactList>;
  /** `null` si la otra parte no existe, no está activa o es de otro centro. */
  loadStartContext(
    actor: ActorContext,
    request: { withMembershipId: string | null; now: Date },
  ): Promise<StartConversationContext | null>;
  findOrCreateConversation(
    actor: ActorContext,
    parties: { memberMembershipId: string; counterpartMembershipId: string | null },
  ): Promise<string>;
  /** `null` si la conversación no existe o no es de quien pregunta. */
  loadAccess(
    actor: ActorContext,
    request: { conversationId: string; now: Date },
  ): Promise<ConversationAccess | null>;
  listMessages(
    actor: ActorContext,
    query: { conversationId: string; before: Date | null; limit: number },
  ): Promise<MessageView[]>;
  appendMessage(actor: ActorContext, message: NewMessage): Promise<MessageView>;
  markRead(actor: ActorContext, request: { conversationId: string; readAt: Date }): Promise<void>;
  /** El mismo mensaje a cada persona de un grupo, en su conversación con el centro. */
  broadcastToGroup(
    actor: ActorContext,
    request: { target: BroadcastTarget; body: string; sentAt: Date },
  ): Promise<GroupBroadcastOutcome>;
}

export const CHAT_REPOSITORY = Symbol('CHAT_REPOSITORY');
