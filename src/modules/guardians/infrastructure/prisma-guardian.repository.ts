import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { isMinor } from '../../chat/domain/chat-rules';
import {
  type ChildView,
  type GuardianRepository,
  type GuardianView,
  type LinkGuardianOutcome,
} from '../application/ports/guardian.repository';

const UPCOMING_BOOKINGS_SHOWN = 3;

async function findActiveClient(client: TenantTransactionClient, membershipId: string) {
  return client.membership.findFirst({
    where: { id: membershipId, role: 'client', status: 'active' },
    select: { id: true, user: { select: { birthDate: true } } },
  });
}

/** Sus próximas reservas confirmadas. */
async function findUpcomingBookings(
  client: TenantTransactionClient,
  input: { childMembershipId: string; now: Date },
): Promise<ChildView['upcomingBookings']> {
  const bookings = await client.booking.findMany({
    where: {
      clientMembershipId: input.childMembershipId,
      status: 'confirmed',
      classSession: { startsAt: { gte: input.now } },
    },
    orderBy: { classSession: { startsAt: 'asc' } },
    take: UPCOMING_BOOKINGS_SHOWN,
    select: {
      id: true,
      classSession: {
        select: {
          startsAt: true,
          service: { select: { name: true } },
          staffMembership: { select: { user: { select: { fullName: true } } } },
        },
      },
    },
  });
  return bookings.map((booking) => ({
    id: booking.id,
    serviceName: booking.classSession.service.name,
    startsAt: booking.classSession.startsAt,
    teacherName: booking.classSession.staffMembership.user.fullName,
  }));
}

/** Las clases que le quedan en sus bonos vigentes. */
async function countRemainingSessions(
  client: TenantTransactionClient,
  input: { childMembershipId: string; now: Date },
): Promise<number> {
  const passes = await client.clientPass.findMany({
    where: {
      clientMembershipId: input.childMembershipId,
      status: 'active',
      remainingSessions: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
    },
    select: { remainingSessions: true },
  });
  return passes.reduce((total, pass) => total + pass.remainingSessions, 0);
}

async function summarizeChild(
  client: TenantTransactionClient,
  input: { childMembershipId: string; now: Date },
): Promise<Pick<ChildView, 'upcomingBookings' | 'remainingSessions'>> {
  return {
    upcomingBookings: await findUpcomingBookings(client, input),
    remainingSessions: await countRemainingSessions(client, input),
  };
}

@Injectable()
export class PrismaGuardianRepository implements GuardianRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listGuardiansOf(
    actor: ActorContext,
    childMembershipId: string,
  ): Promise<GuardianView[] | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const child = await findActiveClient(client, childMembershipId);
      if (!child) return null;
      const links = await client.guardianLink.findMany({
        where: { childMembershipId },
        orderBy: { createdAt: 'asc' },
        select: {
          guardian: { select: { id: true, user: { select: { fullName: true, email: true } } } },
        },
      });
      return links.map(({ guardian }) => ({
        membershipId: guardian.id,
        fullName: guardian.user.fullName,
        email: guardian.user.email,
      }));
    });
  }

  async linkGuardian(
    actor: ActorContext,
    request: { guardianMembershipId: string; childMembershipId: string; now: Date },
  ): Promise<LinkGuardianOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const { guardianMembershipId, childMembershipId, now } = request;
      const guardian = await findActiveClient(client, guardianMembershipId);
      const child = await findActiveClient(client, childMembershipId);
      if (!guardian || !child) return { kind: 'not_found' } as const;
      if (guardian.id === child.id) return { kind: 'invalid_people' } as const;
      if (isMinor(guardian.user.birthDate, now)) return { kind: 'guardian_is_minor' } as const;
      const existing = await client.guardianLink.findFirst({
        where: { guardianMembershipId, childMembershipId },
        select: { id: true },
      });
      if (existing) return { kind: 'already_linked' } as const;
      await client.guardianLink.create({
        data: {
          id: generateUuidV7(),
          centerId: actor.centerId,
          guardianMembershipId,
          childMembershipId,
          createdByMembershipId: actor.membershipId,
        },
      });
      return { kind: 'linked' } as const;
    });
  }

  async unlinkGuardian(
    actor: ActorContext,
    request: { guardianMembershipId: string; childMembershipId: string },
  ): Promise<boolean> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const removed = await client.guardianLink.deleteMany({ where: request });
      return removed.count > 0;
    });
  }

  async listMyChildren(actor: ActorContext, now: Date): Promise<ChildView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const links = await client.guardianLink.findMany({
        where: { guardianMembershipId: actor.membershipId },
        orderBy: { createdAt: 'asc' },
        select: {
          child: {
            select: {
              id: true,
              status: true,
              user: { select: { fullName: true, photoKey: true, birthDate: true } },
            },
          },
        },
      });
      const children = links.map(({ child }) => child).filter(({ status }) => status === 'active');
      return Promise.all(
        children.map(async (child) => ({
          membershipId: child.id,
          fullName: child.user.fullName,
          photoKey: child.user.photoKey,
          isMinor: isMinor(child.user.birthDate, now),
          ...(await summarizeChild(client, { childMembershipId: child.id, now })),
        })),
      );
    });
  }
}
