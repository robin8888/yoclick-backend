import { Injectable } from '@nestjs/common';
import { type Notification } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NotificationList,
  type NotificationRepository,
  type NotificationView,
} from '../application/ports/notification.repository';

function toNotificationView(notification: Notification): NotificationView {
  return {
    id: notification.id,
    kind: notification.kind,
    // Escrito por esta API (`BookingNotificationData`): textos sueltos, nunca estructuras anidadas.
    data: notification.data as Record<string, string>,
    bookingId: notification.bookingId,
    isRead: notification.readAt !== null,
    createdAt: notification.createdAt,
  };
}

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listNotifications(
    actor: ActorContext,
    query: { limit: number },
  ): Promise<NotificationList> {
    const mine = { recipientMembershipId: actor.membershipId };
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const [unreadCount, notifications] = await Promise.all([
        client.notification.count({ where: { ...mine, readAt: null } }),
        client.notification.findMany({
          where: mine,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
        }),
      ]);
      return { unreadCount, notifications: notifications.map(toNotificationView) };
    });
  }

  async markRead(
    actor: ActorContext,
    change: { notificationId: string | null; readAt: Date },
  ): Promise<boolean> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const target = {
        recipientMembershipId: actor.membershipId,
        ...(change.notificationId !== null && { id: change.notificationId }),
      };
      const isFound =
        change.notificationId === null ||
        (await client.notification.count({ where: target })) === 1;
      if (!isFound) return false;
      await client.notification.updateMany({
        where: { ...target, readAt: null },
        data: { readAt: change.readAt },
      });
      return true;
    });
  }
}
