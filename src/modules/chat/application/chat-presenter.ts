import { Injectable } from '@nestjs/common';
import { PhotoUrlSigner } from '../../photos/application/photo-url-signer';
import { type BlockedPersonView, type MessageReportView } from './ports/chat-moderation.repository';
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

  message(message: MessageView, viewerMembershipId: string): Record<string, unknown> {
    const { attachment } = message;
    const isViewerTheMember = viewerMembershipId === message.memberMembershipId;
    const isFromMember = message.senderMembershipId === message.memberMembershipId;
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderMembershipId: message.senderMembershipId,
      senderName: message.senderName,
      /** Del lado de quien mira: sus propios mensajes y, en el centro, los de toda la administración. */
      isMine: isViewerTheMember === isFromMember,
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

  conversation(
    conversation: ConversationView,
    viewerMembershipId: string,
  ): Record<string, unknown> {
    return {
      id: conversation.id,
      counterpart: this.counterpart(conversation.counterpart),
      lastMessage: conversation.lastMessage
        ? this.message(conversation.lastMessage, viewerMembershipId)
        : null,
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

  blockedPerson(person: BlockedPersonView): Record<string, unknown> {
    return {
      membershipId: person.membershipId,
      fullName: person.fullName,
      role: person.role,
      photoUrl: this.urlSigner.sign(person.photoKey),
      blockedAt: person.blockedAt.toISOString(),
    };
  }

  report(report: MessageReportView): Record<string, unknown> {
    return {
      id: report.id,
      reason: report.reason,
      details: report.details,
      status: report.status,
      reporterName: report.reporterName,
      reportedSenderName: report.reportedSenderName,
      reportedBody: report.reportedBody,
      reportedAttachmentName: report.reportedAttachmentName,
      createdAt: report.createdAt.toISOString(),
      reviewedAt: report.reviewedAt === null ? null : report.reviewedAt.toISOString(),
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
