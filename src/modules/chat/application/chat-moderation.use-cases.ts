import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  canReportMessage,
  decideBlock,
  type MessageReportReasonName,
} from '../domain/chat-moderation-rules';
import {
  CHAT_MODERATION_REPOSITORY,
  type BlockedPersonView,
  type ChatModerationRepository,
  type CreatedMessageReport,
  type MessageReportStatusName,
  type MessageReportView,
} from './ports/chat-moderation.repository';

@Injectable()
export class ListBlockedPeopleUseCase {
  constructor(
    @Inject(CHAT_MODERATION_REPOSITORY) private readonly moderation: ChatModerationRepository,
  ) {}

  execute(actor: ActorContext): Promise<BlockedPersonView[]> {
    return this.moderation.listBlocks(actor);
  }
}

@Injectable()
export class BlockPersonUseCase {
  constructor(
    @Inject(CHAT_MODERATION_REPOSITORY) private readonly moderation: ChatModerationRepository,
  ) {}

  /** Bloquea a un alumno (si quien bloquea es profesor) o a un profesor (si es alumno). Idempotente. */
  async execute(actor: ActorContext, blockedMembershipId: string): Promise<BlockedPersonView> {
    const target = await this.moderation.findBlockTarget(actor, blockedMembershipId);
    if (target === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const decision = decideBlock({
      actorRole: actor.role,
      targetRole: target.role,
      isSamePerson: target.id === actor.membershipId,
    });
    if (decision.kind === 'denied') throw new DomainError(decision.code, HTTP_STATUS.forbidden);
    return this.moderation.addBlock(actor, target.id);
  }
}

@Injectable()
export class UnblockPersonUseCase {
  constructor(
    @Inject(CHAT_MODERATION_REPOSITORY) private readonly moderation: ChatModerationRepository,
  ) {}

  /** Idempotente: quitar un bloqueo que no existe no es un error. */
  execute(actor: ActorContext, blockedMembershipId: string): Promise<void> {
    return this.moderation.removeBlock(actor, blockedMembershipId);
  }
}

export interface ReportMessageRequest {
  readonly conversationId: string;
  readonly messageId: string;
  readonly reason: MessageReportReasonName;
  readonly details: string | null;
}

@Injectable()
export class ReportMessageUseCase {
  constructor(
    @Inject(CHAT_MODERATION_REPOSITORY) private readonly moderation: ChatModerationRepository,
  ) {}

  /**
   * Denuncia un mensaje de una conversación en la que se participa. Quien no participa recibe un 404, igual que
   * si el mensaje no existiera. Denunciar dos veces el mismo mensaje no duplica la denuncia ni vuelve a avisar.
   */
  async execute(actor: ActorContext, request: ReportMessageRequest): Promise<CreatedMessageReport> {
    const message = await this.moderation.findReportableMessage(actor, {
      conversationId: request.conversationId,
      messageId: request.messageId,
    });
    if (message === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const isReportable = canReportMessage({
      reporterMembershipId: actor.membershipId,
      senderMembershipId: message.senderMembershipId,
    });
    if (!isReportable) {
      throw new DomainError('CHAT_CANNOT_REPORT_OWN_MESSAGE', HTTP_STATUS.forbidden);
    }
    return this.moderation.createReport(actor, {
      id: generateUuidV7(),
      message,
      reason: request.reason,
      details: request.details,
    });
  }
}

@Injectable()
export class ListMessageReportsUseCase {
  constructor(
    @Inject(CHAT_MODERATION_REPOSITORY) private readonly moderation: ChatModerationRepository,
  ) {}

  execute(
    actor: ActorContext,
    query: { status: MessageReportStatusName | null; limit: number },
  ): Promise<MessageReportView[]> {
    return this.moderation.listReports(actor, query);
  }
}

@Injectable()
export class ReviewMessageReportUseCase {
  constructor(
    @Inject(CHAT_MODERATION_REPOSITORY) private readonly moderation: ChatModerationRepository,
  ) {}

  async execute(actor: ActorContext, reportId: string): Promise<MessageReportView> {
    const report = await this.moderation.reviewReport(actor, { reportId, reviewedAt: new Date() });
    if (report === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return report;
  }
}
