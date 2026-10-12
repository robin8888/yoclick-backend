import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../../generated/prisma/client';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NewRoom,
  type RoomCreationOutcome,
  type RoomPatch,
  type RoomRepository,
  type RoomUpdateOutcome,
  type RoomView,
} from '../application/ports/room.repository';
import { MAX_ROOMS_PER_CENTER } from '../domain/room-rules';

const ROOM_VIEW_FIELDS = {
  id: true,
  name: true,
  capacity: true,
  staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
  fixedService: { select: { id: true, name: true } },
  services: {
    where: { archivedAt: null },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
} satisfies Prisma.RoomSelect;

interface StoredRoom {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
  readonly staffMembership: { id: string; user: { fullName: string } } | null;
  readonly fixedService: { id: string; name: string } | null;
  readonly services: readonly { id: string; name: string }[];
}

function toRoomView(room: StoredRoom): RoomView {
  return {
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    staff:
      room.staffMembership === null
        ? null
        : { membershipId: room.staffMembership.id, fullName: room.staffMembership.user.fullName },
    fixedService: room.fixedService,
    services: room.services.map(({ id, name }) => ({ id, name })),
  };
}

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

/** La RLS acota al centro: una persona de otro centro simplemente no se encuentra. */
async function isActiveTeamMember(
  client: TenantTransactionClient,
  membershipId: string,
): Promise<boolean> {
  const count = await client.membership.count({
    where: { id: membershipId, status: 'active', role: { in: [...TEAM_ROLES] } },
  });
  return count === 1;
}

/** Si todos los servicios indicados existen y no están archivados (la RLS acota al centro). */
async function doServicesExist(
  client: TenantTransactionClient,
  serviceIds: readonly string[],
): Promise<boolean> {
  if (serviceIds.length === 0) return true;
  const count = await client.service.count({
    where: { id: { in: [...serviceIds] }, archivedAt: null },
  });
  return count === new Set(serviceIds).size;
}

/** La sala pasa a dar exactamente estos servicios: los demás que la tenían quedan sin sala fija. */
async function assignServicesToRoom(
  client: TenantTransactionClient,
  roomId: string,
  serviceIds: readonly string[],
): Promise<void> {
  await client.service.updateMany({
    where: { roomId, id: { notIn: [...serviceIds] } },
    data: { roomId: null },
  });
  if (serviceIds.length === 0) return;
  await client.service.updateMany({
    where: { id: { in: [...serviceIds] }, archivedAt: null },
    data: { roomId },
  });
}

async function isNameTaken(
  client: TenantTransactionClient,
  name: string,
  exceptRoomId: string | null,
): Promise<boolean> {
  const sameName = await client.room.findFirst({
    where: {
      archivedAt: null,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptRoomId !== null && { id: { not: exceptRoomId } }),
    },
    select: { id: true },
  });
  return sameName !== null;
}

type PatchRefusal = Extract<
  RoomUpdateOutcome,
  { kind: 'duplicate_name' | 'staff_not_found' | 'service_not_found' }
>;

/** Lo que impide aplicar el cambio (nombre repetido, persona o servicio que no existen), si algo. */
async function findPatchRefusal(
  client: TenantTransactionClient,
  input: { roomId: string; patch: RoomPatch },
): Promise<PatchRefusal | null> {
  const { roomId, patch } = input;
  if (patch.name !== undefined && (await isNameTaken(client, patch.name, roomId))) {
    return { kind: 'duplicate_name' };
  }
  const { staffMembershipId } = patch;
  if (
    staffMembershipId !== undefined &&
    staffMembershipId !== null &&
    !(await isActiveTeamMember(client, staffMembershipId))
  ) {
    return { kind: 'staff_not_found' };
  }
  if (!(await doPatchServicesExist(client, patch))) return { kind: 'service_not_found' };
  return null;
}

/** Los servicios de la sala y su servicio fijo, si se envían, tienen que existir. */
async function doPatchServicesExist(
  client: TenantTransactionClient,
  patch: RoomPatch,
): Promise<boolean> {
  const { serviceId, serviceIds } = patch;
  if (serviceIds !== undefined && !(await doServicesExist(client, serviceIds))) return false;
  if (serviceId === undefined || serviceId === null) return true;
  return doServicesExist(client, [serviceId]);
}

/** La lista de servicios de la sala, si se envió; si solo llegó el servicio fijo, este pasa a darse en ella. */
async function applyServicePatch(
  client: TenantTransactionClient,
  roomId: string,
  patch: RoomPatch,
): Promise<void> {
  if (patch.serviceIds !== undefined) {
    await assignServicesToRoom(client, roomId, withFixedService(patch.serviceIds, patch.serviceId));
    return;
  }
  if (typeof patch.serviceId !== 'string') return;
  await client.service.updateMany({
    where: { id: patch.serviceId, archivedAt: null },
    data: { roomId },
  });
}

/** El servicio fijo de la sala también se da en ella: entra en su lista aunque no se enviara. */
function withFixedService(
  serviceIds: readonly string[],
  serviceId: string | null | undefined,
): readonly string[] {
  if (serviceId === undefined || serviceId === null || serviceIds.includes(serviceId))
    return serviceIds;
  return [...serviceIds, serviceId];
}

@Injectable()
export class PrismaRoomRepository implements RoomRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listRooms(actor: ActorContext): Promise<RoomView[]> {
    const rooms = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.room.findMany({
        where: { archivedAt: null },
        select: ROOM_VIEW_FIELDS,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return rooms.map(toRoomView);
  }

  async createRoom(actor: ActorContext, newRoom: NewRoom): Promise<RoomCreationOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const activeRoomCount = await client.room.count({ where: { archivedAt: null } });
      if (activeRoomCount >= MAX_ROOMS_PER_CENTER) return { kind: 'limit_reached' };
      if (await isNameTaken(client, newRoom.name, null)) return { kind: 'duplicate_name' };
      const { staffMembershipId } = newRoom;
      if (staffMembershipId !== null && !(await isActiveTeamMember(client, staffMembershipId))) {
        return { kind: 'staff_not_found' };
      }

      const serviceIds = withFixedService(newRoom.serviceIds, newRoom.serviceId);
      if (!(await doServicesExist(client, serviceIds))) {
        return { kind: 'service_not_found' };
      }

      const created = await client.room.create({
        data: {
          id: generateUuidV7(),
          centerId: actor.centerId,
          name: newRoom.name,
          capacity: newRoom.capacity,
          staffMembershipId,
          serviceId: newRoom.serviceId,
        },
        select: { id: true },
      });
      await assignServicesToRoom(client, created.id, serviceIds);
      const room = await client.room.findUniqueOrThrow({
        where: { id: created.id },
        select: ROOM_VIEW_FIELDS,
      });
      return { kind: 'created', room: toRoomView(room) };
    });
  }

  async updateRoom(
    actor: ActorContext,
    roomId: string,
    patch: RoomPatch,
  ): Promise<RoomUpdateOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const existing = await client.room.findFirst({
        where: { id: roomId, archivedAt: null },
        select: { id: true },
      });
      if (!existing) return { kind: 'not_found' };
      const refusal = await findPatchRefusal(client, { roomId, patch });
      if (refusal !== null) return refusal;
      const { staffMembershipId } = patch;

      await client.room.update({
        where: { id: roomId },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.capacity !== undefined && { capacity: patch.capacity }),
          ...(staffMembershipId !== undefined && { staffMembershipId }),
          ...(patch.serviceId !== undefined && { serviceId: patch.serviceId }),
        },
      });
      await applyServicePatch(client, roomId, patch);
      const room = await client.room.findUniqueOrThrow({
        where: { id: roomId },
        select: ROOM_VIEW_FIELDS,
      });
      return { kind: 'updated', room: toRoomView(room) };
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
