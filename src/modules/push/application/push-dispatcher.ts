import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';
import { getPushCopy } from '../domain/push-copy';
import { PUSH_SENDER, type PushMessage, type PushSender } from './ports/push-sender';

/** Un aviso que lleva más de esto sin enviarse ya no tiene sentido empujarlo al móvil. */
const MAX_PUSH_DELAY_HOURS = 1;
const MAX_NOTIFICATIONS_PER_FLUSH = 200;

interface PendingNotification {
  readonly id: string;
  readonly kind: string;
  readonly recipient: { readonly userId: string };
}

/** Un mensaje por cada móvil de cada destinatario; quien no tiene móvil solo ve el aviso en la app. */
function buildPushMessages(input: {
  readonly pending: readonly PendingNotification[];
  readonly devices: readonly { readonly userId: string; readonly token: string }[];
  readonly centerId: string;
}): PushMessage[] {
  return input.pending.flatMap((notification) =>
    input.devices
      .filter(({ userId }) => userId === notification.recipient.userId)
      .map(({ token }) => ({
        to: token,
        ...getPushCopy(notification.kind),
        data: {
          notificationId: notification.id,
          centerId: input.centerId,
          kind: notification.kind,
        },
      })),
  );
}

/**
 * Convierte en avisos al móvil las notificaciones nuevas de un centro. Las notificaciones se
 * escriben junto a la acción que las provoca; este envío ocurre DESPUÉS de que esa acción se
 * confirme y nunca la rompe: si falla, los avisos quedan pendientes y se reintentan en el
 * siguiente envío. Quien no tiene móvil registrado ve el aviso igualmente dentro de la app.
 */
@Injectable()
export class PushDispatcher {
  private readonly logger = new Logger(PushDispatcher.name);

  constructor(
    private readonly tenantPrismaService: TenantPrismaService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  async flushCenter(actor: ActorContext): Promise<void> {
    try {
      await this.sendPendingNotifications(actor);
    } catch (error) {
      this.logger.error('Could not send the push notifications of a center', error);
    }
  }

  private async sendPendingNotifications(actor: ActorContext): Promise<void> {
    const since = new Date(Date.now() - MAX_PUSH_DELAY_HOURS * MILLISECONDS_PER_HOUR);
    const pending = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.notification.findMany({
        where: { pushedAt: null, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        take: MAX_NOTIFICATIONS_PER_FLUSH,
        select: { id: true, kind: true, recipient: { select: { userId: true } } },
      }),
    );
    if (pending.length === 0) return;

    const userIds = [...new Set(pending.map(({ recipient }) => recipient.userId))];
    const devices = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.pushDevice.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, token: true },
      }),
    );
    const messages = buildPushMessages({ pending, devices, centerId: actor.centerId });

    const { invalidTokens } =
      messages.length === 0 ? { invalidTokens: [] } : await this.sender.send(messages);
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.notification.updateMany({
        where: { id: { in: pending.map(({ id }) => id) } },
        data: { pushedAt: new Date() },
      });
      if (invalidTokens.length > 0) {
        await client.pushDevice.deleteMany({ where: { token: { in: [...invalidTokens] } } });
      }
    });
  }
}
