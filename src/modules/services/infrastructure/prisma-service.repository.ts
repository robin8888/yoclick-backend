import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NewService,
  type ServicePatch,
  type ServiceRepository,
  type ServiceView,
  type ServiceWriteOutcome,
} from '../application/ports/service.repository';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

/** Solo cuenta quien sigue en el equipo: una baja no debe aparecer como profesional. */
const WITH_ACTIVE_STAFF = {
  room: { select: { id: true, name: true } },
  staff: {
    where: { membership: { status: 'active', role: { in: [...TEAM_ROLES] } } },
    orderBy: [{ membership: { joinedAt: 'asc' } }, { membershipId: 'asc' }],
    include: { membership: { select: { id: true, user: { select: { fullName: true } } } } },
  },
} satisfies Prisma.ServiceInclude;

type ServiceWithStaff = Prisma.ServiceGetPayload<{ include: typeof WITH_ACTIVE_STAFF }>;

function toServiceView(service: ServiceWithStaff): ServiceView {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    kind: 'individual',
    durationMinutes: service.durationMinutes,
    priceCents: service.priceCents,
    color: service.color,
    bookingWindowDays: service.bookingWindowDays,
    minNoticeMinutes: service.minNoticeMinutes,
    isVisible: service.isVisible,
    room: service.room,
    staff: service.staff.map(({ membership }) => ({
      membershipId: membership.id,
      fullName: membership.user.fullName,
    })),
  };
}

/** Los campos enviados salvo `staffMembershipIds`, que va a otra tabla. Lo no enviado no se toca. */
function toUpdateData(patch: ServicePatch): Prisma.ServiceUpdateInput {
  const sentFields = Object.entries(patch).filter(
    ([field, value]) => field !== 'staffMembershipIds' && value !== undefined,
  );
  return Object.fromEntries(sentFields);
}

async function areAllActiveTeamMembers(
  client: TenantTransactionClient,
  membershipIds: readonly string[],
): Promise<boolean> {
  const uniqueIds = [...new Set(membershipIds)];
  // La RLS acota a este centro: una membresía de otro centro simplemente no se cuenta.
  const matchingCount = await client.membership.count({
    where: { id: { in: uniqueIds }, status: 'active', role: { in: [...TEAM_ROLES] } },
  });
  return matchingCount === uniqueIds.length;
}

/** La RLS acota a este centro y `archivedAt` excluye las salas quitadas. */
async function isActiveRoom(client: TenantTransactionClient, roomId: string): Promise<boolean> {
  return (await client.room.count({ where: { id: roomId, archivedAt: null } })) === 1;
}

async function readServiceWithStaff(
  client: TenantTransactionClient,
  serviceId: string,
): Promise<ServiceView> {
  const service = await client.service.findUniqueOrThrow({
    where: { id: serviceId },
    include: WITH_ACTIVE_STAFF,
  });
  return toServiceView(service);
}

async function replaceStaff(
  client: TenantTransactionClient,
  serviceId: string,
  membershipIds: readonly string[],
): Promise<void> {
  await client.serviceStaff.deleteMany({ where: { serviceId } });
  await client.serviceStaff.createMany({
    data: [...new Set(membershipIds)].map((membershipId) => ({ serviceId, membershipId })),
  });
}

@Injectable()
export class PrismaServiceRepository implements ServiceRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listServices(
    actor: ActorContext,
    filter: { readonly onlyVisible: boolean },
  ): Promise<ServiceView[]> {
    const services = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.service.findMany({
        where: { archivedAt: null, ...(filter.onlyVisible && { isVisible: true }) },
        include: WITH_ACTIVE_STAFF,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    );
    return services.map(toServiceView);
  }

  async createService(actor: ActorContext, newService: NewService): Promise<ServiceWriteOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if (!(await areAllActiveTeamMembers(client, newService.staffMembershipIds))) {
        return { kind: 'unknown_staff' };
      }
      if (newService.roomId !== null && !(await isActiveRoom(client, newService.roomId))) {
        return { kind: 'unknown_room' };
      }
      const lastService = await client.service.aggregate({ _max: { sortOrder: true } });
      const serviceId = generateUuidV7();
      await client.service.create({
        data: {
          id: serviceId,
          centerId: actor.centerId,
          sortOrder: (lastService._max.sortOrder ?? -1) + 1,
          name: newService.name,
          description: newService.description,
          durationMinutes: newService.durationMinutes,
          priceCents: newService.priceCents,
          color: newService.color,
          roomId: newService.roomId,
          // Lo no enviado toma el valor por defecto de la tabla.
          ...(newService.bookingWindowDays !== undefined && {
            bookingWindowDays: newService.bookingWindowDays,
          }),
          ...(newService.minNoticeMinutes !== undefined && {
            minNoticeMinutes: newService.minNoticeMinutes,
          }),
          ...(newService.isVisible !== undefined && { isVisible: newService.isVisible }),
        },
      });
      await replaceStaff(client, serviceId, newService.staffMembershipIds);
      return { kind: 'saved', service: await readServiceWithStaff(client, serviceId) };
    });
  }

  async updateService(
    actor: ActorContext,
    serviceId: string,
    patch: ServicePatch,
  ): Promise<ServiceWriteOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const existing = await client.service.findFirst({
        where: { id: serviceId, archivedAt: null },
        select: { id: true },
      });
      if (!existing) return { kind: 'not_found' };
      if (
        patch.staffMembershipIds !== undefined &&
        !(await areAllActiveTeamMembers(client, patch.staffMembershipIds))
      ) {
        return { kind: 'unknown_staff' };
      }
      if (typeof patch.roomId === 'string' && !(await isActiveRoom(client, patch.roomId))) {
        return { kind: 'unknown_room' };
      }
      await client.service.update({ where: { id: serviceId }, data: toUpdateData(patch) });
      if (patch.staffMembershipIds !== undefined) {
        await replaceStaff(client, serviceId, patch.staffMembershipIds);
      }
      return { kind: 'saved', service: await readServiceWithStaff(client, serviceId) };
    });
  }

  async archiveService(actor: ActorContext, serviceId: string): Promise<boolean> {
    const result = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.service.updateMany({
        where: { id: serviceId, archivedAt: null },
        data: { archivedAt: new Date() },
      }),
    );
    return result.count === 1;
  }
}
