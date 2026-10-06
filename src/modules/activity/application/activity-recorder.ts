import { Injectable, Logger } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ActivityKind } from '../domain/activity-kind';

export interface ActivityEntry {
  readonly kind: ActivityKind;
  /** Sobre qué o quién fue (el nombre del servicio, de la persona…). */
  readonly subject?: string | null;
}

/**
 * Anota en el registro de actividad quién hizo qué. Se llama cuando la acción ya salió bien: si
 * anotarla fallara, no se deshace lo que la persona hizo (se deja constancia en el log técnico).
 */
@Injectable()
export class ActivityRecorder {
  private readonly logger = new Logger(ActivityRecorder.name);

  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async record(actor: ActorContext, entry: ActivityEntry): Promise<void> {
    try {
      await this.tenantPrismaService.runInTenantContext(actor, (client) =>
        client.activityLog.create({
          data: {
            id: generateUuidV7(),
            centerId: actor.centerId,
            actorMembershipId: actor.membershipId === '' ? null : actor.membershipId,
            kind: entry.kind,
            subject: entry.subject ?? null,
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Could not record activity ${entry.kind}`, error);
    }
  }
}
