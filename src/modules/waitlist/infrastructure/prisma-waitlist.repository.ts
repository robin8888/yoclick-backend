import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  joinGroupSessionInTransaction,
  lockSessionSeats,
} from '../../bookings/infrastructure/booking-creation';
import {
  type ConfirmOfferOutcome,
  type JoinWaitlistOutcome,
  type SessionWaitlistPersonView,
  type WaitlistEntryView,
  type WaitlistRepository,
} from '../application/ports/waitlist.repository';
import { isOfferActive } from '../domain/waitlist-rules';
import { advanceSessionWaitlist } from './waitlist-advance';

const ENTRY_INCLUDE = {
  classSession: {
    select: {
      startsAt: true,
      endsAt: true,
      service: { select: { id: true, name: true } },
    },
  },
} as const;

type StoredEntry = Prisma.WaitlistEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

/** Para contar la cola hay que ver a todos los que esperan, no solo a la propia persona. */
function withTeamVisibility(actor: ActorContext): ActorContext {
  return { ...actor, role: 'staff' };
}

/** El aviso de Stripe y el barrido llegan sin sesión: se actúa como la administración del centro. */
function buildSystemActor(centerId: string): ActorContext {
  return { userId: '', centerId, membershipId: '', role: 'owner', permissions: [] };
}

async function toEntryView(
  client: TenantTransactionClient,
  entry: StoredEntry,
): Promise<WaitlistEntryView> {
  const isWaiting = entry.status === 'waiting';
  const position = isWaiting
    ? (await client.waitlistEntry.count({
        where: {
          classSessionId: entry.classSessionId,
          status: 'waiting',
          OR: [
            { createdAt: { lt: entry.createdAt } },
            { createdAt: entry.createdAt, id: { lt: entry.id } },
          ],
        },
      })) + 1
    : null;
  return {
    id: entry.id,
    status: isWaiting ? 'waiting' : 'offered',
    classSessionId: entry.classSessionId,
    createdAt: entry.createdAt,
    position,
    offerExpiresAt: entry.offerExpiresAt,
    session: entry.classSession,
  };
}

async function hasFreeSeats(
  client: TenantTransactionClient,
  input: { session: { id: string; capacity: number }; now: Date },
): Promise<boolean> {
  const [bookedCount, heldCount] = await Promise.all([
    client.booking.count({
      where: { classSessionId: input.session.id, status: { not: 'cancelled' } },
    }),
    client.waitlistEntry.count({
      where: {
        classSessionId: input.session.id,
        status: 'offered',
        offerExpiresAt: { gt: input.now },
      },
    }),
  ]);
  return bookedCount + heldCount < input.session.capacity;
}

/** La persona ya tiene plaza en la clase o ya está esperando por ella. */
async function findJoinRefusal(
  client: TenantTransactionClient,
  input: { classSessionId: string; clientMembershipId: string },
): Promise<{ kind: 'already_booked' } | { kind: 'already_waiting' } | null> {
  const [bookingCount, activeEntryCount] = await Promise.all([
    client.booking.count({
      where: {
        classSessionId: input.classSessionId,
        clientMembershipId: input.clientMembershipId,
        status: { not: 'cancelled' },
      },
    }),
    client.waitlistEntry.count({
      where: {
        classSessionId: input.classSessionId,
        clientMembershipId: input.clientMembershipId,
        status: { in: ['waiting', 'offered'] },
      },
    }),
  ]);
  if (bookingCount > 0) return { kind: 'already_booked' };
  return activeEntryCount > 0 ? { kind: 'already_waiting' } : null;
}

@Injectable()
export class PrismaWaitlistRepository implements WaitlistRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async join(
    actor: ActorContext,
    command: { classSessionId: string; now: Date },
  ): Promise<JoinWaitlistOutcome> {
    return this.tenantPrismaService.runInTenantContext(
      withTeamVisibility(actor),
      async (client) => {
        await lockSessionSeats(client, command.classSessionId);
        const session = await client.classSession.findFirst({
          where: {
            id: command.classSessionId,
            status: 'scheduled',
            mode: 'group',
            startsAt: { gt: command.now },
          },
          select: { id: true, capacity: true },
        });
        if (!session) return { kind: 'session_not_found' };
        if (await hasFreeSeats(client, { session, now: command.now })) {
          return { kind: 'session_has_seats' };
        }
        const refusal = await findJoinRefusal(client, {
          classSessionId: session.id,
          clientMembershipId: actor.membershipId,
        });
        if (refusal) return refusal;
        const created = await client.waitlistEntry.create({
          data: {
            id: generateUuidV7(),
            centerId: actor.centerId,
            classSessionId: session.id,
            clientMembershipId: actor.membershipId,
          },
          include: ENTRY_INCLUDE,
        });
        return { kind: 'joined', entry: await toEntryView(client, created) };
      },
    );
  }

  async leave(
    actor: ActorContext,
    command: { entryId: string },
  ): Promise<{ wasFound: boolean; hadOffer: boolean }> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const entry = await client.waitlistEntry.findFirst({
        where: {
          id: command.entryId,
          clientMembershipId: actor.membershipId,
          status: { in: ['waiting', 'offered'] },
        },
      });
      if (!entry) return { wasFound: false, hadOffer: false };
      const left = await client.waitlistEntry.updateMany({
        where: { id: entry.id, status: { in: ['waiting', 'offered'] } },
        data: { status: 'cancelled' },
      });
      return { wasFound: left.count === 1, hadOffer: entry.status === 'offered' };
    });
  }

  async removeFromSession(
    actor: ActorContext,
    command: { entryId: string; classSessionId: string },
  ): Promise<{ wasFound: boolean; hadOffer: boolean }> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const entry = await client.waitlistEntry.findFirst({
        where: {
          id: command.entryId,
          classSessionId: command.classSessionId,
          status: { in: ['waiting', 'offered'] },
        },
      });
      if (!entry) return { wasFound: false, hadOffer: false };
      const removed = await client.waitlistEntry.updateMany({
        where: { id: entry.id, status: { in: ['waiting', 'offered'] } },
        data: { status: 'cancelled' },
      });
      return { wasFound: removed.count === 1, hadOffer: entry.status === 'offered' };
    });
  }

  async listForSession(
    actor: ActorContext,
    query: { classSessionId: string; now: Date },
  ): Promise<SessionWaitlistPersonView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const entries = await client.waitlistEntry.findMany({
        where: { classSessionId: query.classSessionId, status: { in: ['waiting', 'offered'] } },
        include: {
          clientMembership: { select: { id: true, user: { select: { fullName: true } } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const live = entries.filter(
        (entry) => entry.status === 'waiting' || isOfferActive(entry, query.now),
      );
      const offered = live.filter((entry) => entry.status === 'offered');
      const waiting = live.filter((entry) => entry.status === 'waiting');
      return [...offered, ...waiting].map((entry) => ({
        id: entry.id,
        status: entry.status === 'waiting' ? 'waiting' : 'offered',
        createdAt: entry.createdAt,
        position: entry.status === 'waiting' ? waiting.indexOf(entry) + 1 : null,
        offerExpiresAt: entry.offerExpiresAt,
        client: {
          membershipId: entry.clientMembership.id,
          fullName: entry.clientMembership.user.fullName,
        },
      }));
    });
  }

  async listMine(actor: ActorContext, query: { now: Date }): Promise<WaitlistEntryView[]> {
    return this.tenantPrismaService.runInTenantContext(
      withTeamVisibility(actor),
      async (client) => {
        const entries = await client.waitlistEntry.findMany({
          where: {
            clientMembershipId: actor.membershipId,
            status: { in: ['waiting', 'offered'] },
            classSession: { startsAt: { gt: query.now } },
          },
          include: ENTRY_INCLUDE,
          orderBy: [{ classSession: { startsAt: 'asc' } }, { id: 'asc' }],
        });
        const live = entries.filter(
          (entry) => entry.status === 'waiting' || isOfferActive(entry, query.now),
        );
        return Promise.all(live.map((entry) => toEntryView(client, entry)));
      },
    );
  }

  async confirm(
    actor: ActorContext,
    command: { entryId: string; now: Date },
  ): Promise<ConfirmOfferOutcome> {
    return this.tenantPrismaService.runInTenantContext(
      withTeamVisibility(actor),
      async (client) => {
        const entry = await client.waitlistEntry.findFirst({
          where: { id: command.entryId, clientMembershipId: actor.membershipId, status: 'offered' },
        });
        if (!entry) return { kind: 'not_found' };
        if (!isOfferActive(entry, command.now)) return { kind: 'offer_expired' };
        const outcome = await joinGroupSessionInTransaction(client, actor, {
          classSessionId: entry.classSessionId,
          clientMembershipId: actor.membershipId,
          now: command.now,
          isClientBooking: true,
        });
        if (outcome.kind !== 'created') return { kind: 'refused', reason: outcome.kind };
        await client.waitlistEntry.update({
          where: { id: entry.id },
          data: { status: 'confirmed' },
        });
        return { kind: 'confirmed', booking: outcome.booking };
      },
    );
  }

  async advanceCenter(actor: ActorContext, command: { now: Date }): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(
      buildSystemActor(actor.centerId),
      async (client) => {
        const waiting = await client.waitlistEntry.findMany({
          where: { status: { in: ['waiting', 'offered'] } },
          select: { classSessionId: true },
          distinct: ['classSessionId'],
        });
        for (const { classSessionId } of waiting) {
          await advanceSessionWaitlist(client, { classSessionId, now: command.now });
        }
      },
    );
  }

  async findCentersWithExpiredOffers(query: { now: Date }): Promise<string[]> {
    return this.tenantPrismaService.runInWaitlistSweepContext(async (client) => {
      const due = await client.waitlistEntry.findMany({
        where: { status: 'offered', offerExpiresAt: { lte: query.now } },
        select: { centerId: true },
        distinct: ['centerId'],
      });
      return due.map(({ centerId }) => centerId);
    });
  }
}
