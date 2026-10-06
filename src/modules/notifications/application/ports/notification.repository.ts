import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type NotificationKindName } from '../../domain/notification-rules';

export interface NotificationView {
  readonly id: string;
  readonly kind: NotificationKindName;
  readonly data: Record<string, string>;
  readonly bookingId: string | null;
  readonly isRead: boolean;
  readonly createdAt: Date;
}

export interface NotificationList {
  /** Los no leídos de esta persona, aunque no entren todos en `notifications`. */
  readonly unreadCount: number;
  readonly notifications: readonly NotificationView[];
}

export interface NotificationRepository {
  /** Solo los avisos de quien pregunta, del más reciente al más antiguo. */
  listNotifications(actor: ActorContext, query: { limit: number }): Promise<NotificationList>;
  /** Marca como leídos todos (`notificationId` = `null`) o uno. `false` si ese uno no existe. */
  markRead(
    actor: ActorContext,
    change: { notificationId: string | null; readAt: Date },
  ): Promise<boolean>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
