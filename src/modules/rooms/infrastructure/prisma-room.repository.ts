import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NewRoom,
  type RoomCreationOutcome,
  type RoomRepository,
  type RoomView,
} from '../application/ports/room.repository';
import { MAX_ROOMS_PER_CENTER } from '../domain/room-rules';

const ROOM_VIEW_FIELDS = { id: true, name: true, capacity: true } as const;

@Injectable()
export class PrismaRoomRepository implements RoomRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listRooms(actor: ActorContext): Promise<RoomView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.room.findMany({
        where: { archivedAt: null },
        select: ROOM_VIEW_FIELDS,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  }

  async createRoom(actor: ActorContext, newRoom: NewRoom): Promise<RoomCreationOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const activeRoomCount = await client.room.count({ where: { archivedAt: null } });
      if (activeRoomCount >= MAX_ROOMS_PER_CENTER) return { kind: 'limit_reached' };
      const sameName = await client.room.findFirst({
        where: { archivedAt: null, name: { equals: newRoom.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (sameName) return { kind: 'duplicate_name' };

      const room = await client.room.create({
        data: { id: generateUuidV7(), centerId: actor.centerId, ...newRoom },
        select: ROOM_VIEW_FIELDS,
      });
      return { kind: 'created', room };
    });
  }

  async archiveRoom(actor: ActorContext, roomId: string): Promise<boolean> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const archived = await client.room.updateMany({
        where: { id: roomId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (archived.count !== 1) return false;
      await client.service.updateMany({ where: { roomId }, data: { roomId: null } });
      return true;
    });
  }
}
