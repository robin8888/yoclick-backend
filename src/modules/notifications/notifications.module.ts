import { Module } from '@nestjs/common';
import {
  DeleteNotificationsUseCase,
  ListNotificationsUseCase,
  MarkNotificationsReadUseCase,
} from './application/notification.use-cases';
import { NOTIFICATION_REPOSITORY } from './application/ports/notification.repository';
import { NotificationsController } from './http/notifications.controller';
import { PrismaNotificationRepository } from './infrastructure/prisma-notification.repository';

@Module({
  controllers: [NotificationsController],
  providers: [
    DeleteNotificationsUseCase,
    ListNotificationsUseCase,
    MarkNotificationsReadUseCase,
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
  ],
})
export class NotificationsModule {}
