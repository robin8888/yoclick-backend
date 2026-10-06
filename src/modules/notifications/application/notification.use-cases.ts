import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationList,
  type NotificationRepository,
} from './ports/notification.repository';

@Injectable()
export class ListNotificationsUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
  ) {}

  async execute(actor: ActorContext, query: { limit: number }): Promise<NotificationList> {
    return this.notifications.listNotifications(actor, query);
  }
}

@Injectable()
export class MarkNotificationsReadUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
  ) {}

  /** `notificationId` = `null` marca todos los avisos de quien pregunta. */
  async execute(actor: ActorContext, notificationId: string | null): Promise<void> {
    const wasFound = await this.notifications.markRead(actor, {
      notificationId,
      readAt: new Date(),
    });
    if (!wasFound) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
