import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_KINDS,
} from '../domain/notification-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class NotificationRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), notificationId: z.uuid() }),
) {}

export class NotificationListQueryDto extends createZodDto(
  z.strictObject({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_NOTIFICATION_PAGE_SIZE)
      .default(DEFAULT_NOTIFICATION_PAGE_SIZE),
  }),
) {}

export class NotificationListResponseDto extends createZodDto(
  z.strictObject({
    /** Los no leídos de esta persona, aunque no entren todos en la lista. */
    unreadCount: z.number().int(),
    notifications: z.array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum(NOTIFICATION_KINDS),
        /** Cliente, servicio, hora (UTC) y quien da la cita: la app compone el texto. */
        data: z.record(z.string(), z.string()),
        bookingId: z.uuid().nullable(),
        isRead: z.boolean(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
) {}
