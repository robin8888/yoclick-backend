import { Injectable } from '@nestjs/common';
import { PhotoUrlSigner } from '../../photos/application/photo-url-signer';
import {
  type ContactView,
  type ConversationView,
  type CounterpartView,
  type MessageView,
} from './ports/chat.repository';

/** Pasa lo guardado a lo que ve la app: rutas del almacén convertidas en enlaces firmados. */
@Injectable()
export class ChatPresenter {
  constructor(private readonly urlSigner: PhotoUrlSigner) {}

  message(message: MessageView): Record<string, unknown> {
    const { attachment } = message;
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderMembershipId: message.senderMembershipId,
      senderName: message.senderName,
      body: message.body,
      attachment:
        attachment === null
          ? null
          : {
              kind: attachment.kind,
              name: attachment.name,
              sizeBytes: attachment.sizeBytes,
              url: this.urlSigner.sign(attachment.key) ?? '',
            },
      createdAt: message.createdAt.toISOString(),
    };
  }

  conversation(conversation: ConversationView): Record<string, unknown> {
    return {
      id: conversation.id,
      counterpart: this.counterpart(conversation.counterpart),
      lastMessage: conversation.lastMessage ? this.message(conversation.lastMessage) : null,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      unreadCount: conversation.unreadCount,
    };
  }

  contact(contact: ContactView): Record<string, unknown> {
    return {
      membershipId: contact.membershipId,
      fullName: contact.fullName,
      role: contact.role,
      photoUrl: this.urlSigner.sign(contact.photoKey),
    };
  }

  private counterpart(counterpart: CounterpartView): Record<string, unknown> {
    if (counterpart.kind === 'center') return { kind: 'center' };
    return {
      kind: 'person',
      membershipId: counterpart.membershipId,
      fullName: counterpart.fullName,
      role: counterpart.role,
      photoUrl: this.urlSigner.sign(counterpart.photoKey),
    };
  }
}
