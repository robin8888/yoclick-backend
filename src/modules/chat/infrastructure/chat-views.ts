import { type MembershipRoleName } from '../../../shared/tenancy/actor-context';
import {
  type AttachmentView,
  type ContactView,
  type CounterpartView,
  type MessageView,
} from '../application/ports/chat.repository';

export const PERSON_SELECT = {
  id: true,
  role: true,
  user: { select: { fullName: true, photoKey: true, birthDate: true } },
} as const;

export interface StoredPerson {
  readonly id: string;
  readonly role: MembershipRoleName;
  readonly user: {
    readonly fullName: string;
    readonly photoKey: string | null;
    readonly birthDate: Date | null;
  };
}

export const MESSAGE_INCLUDE = {
  sender: { select: { user: { select: { fullName: true } } } },
  conversation: { select: { memberMembershipId: true } },
} as const;

export interface StoredMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderMembershipId: string;
  readonly body: string | null;
  readonly attachmentKey: string | null;
  readonly attachmentKind: 'image' | 'pdf' | null;
  readonly attachmentName: string | null;
  readonly attachmentSizeBytes: number | null;
  readonly createdAt: Date;
  readonly sender: { readonly user: { readonly fullName: string } };
  readonly conversation: { readonly memberMembershipId: string };
}

function toAttachment(message: StoredMessage): AttachmentView | null {
  const { attachmentKey, attachmentKind } = message;
  if (attachmentKey === null || attachmentKind === null) return null;
  return {
    kind: attachmentKind,
    key: attachmentKey,
    name: message.attachmentName ?? '',
    sizeBytes: message.attachmentSizeBytes ?? 0,
  };
}

export function toMessageView(message: StoredMessage): MessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    memberMembershipId: message.conversation.memberMembershipId,
    senderMembershipId: message.senderMembershipId,
    senderName: message.sender.user.fullName,
    body: message.body,
    attachment: toAttachment(message),
    createdAt: message.createdAt,
  };
}

export function toPersonCounterpart(person: StoredPerson): CounterpartView {
  return {
    kind: 'person',
    membershipId: person.id,
    fullName: person.user.fullName,
    role: person.role,
    photoKey: person.user.photoKey,
  };
}

export function toContact(person: StoredPerson): ContactView {
  return {
    membershipId: person.id,
    fullName: person.user.fullName,
    role: person.role,
    photoKey: person.user.photoKey,
  };
}
