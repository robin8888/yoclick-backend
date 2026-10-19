import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { lockSessionSeats } from '../../bookings/infrastructure/booking-creation';
import { computeOfferExpiry, countOfferableSeats } from '../domain/waitlist-rules';

interface SessionToAdvance {
  readonly id: string;
  readonly centerId: string;
  readonly capacity: number;
  readonly startsAt: Date;
  readonly service: { readonly name: string };
}

async function notifyOffer(
  client: TenantTransactionClient,
  input: {
    session: SessionToAdvance;
    recipientMembershipId: string;
    kind: 'waitlist_offer' | 'waitlist_offer_expired';
    offerExpiresAt: Date;
  },
): Promise<void> {
  const { session } = input;
  await client.notification.create({
    data: {
      id: generateUuidV7(),
      centerId: session.centerId,
      recipientMembershipId: input.recipientMembershipId,
      kind: input.kind,
      data: {
        serviceName: session.service.name,
        startsAt: session.startsAt.toISOString(),
        expiresAt: input.offerExpiresAt.toISOString(),
      },
    },
  });
}

/** Las ofertas que se dejaron pasar: la persona pierde la plaza y se le avisa. */
async function expireStaleOffers(
  client: TenantTransactionClient,
  input: { session: SessionToAdvance; now: Date },
): Promise<void> {
  const stale = await client.waitlistEntry.findMany({
    where: {
      classSessionId: input.session.id,
      status: 'offered',
      offerExpiresAt: { lte: input.now },
    },
  });
  for (const entry of stale) {
    const marked = await client.waitlistEntry.updateMany({
      where: { id: entry.id, status: 'offered' },
      data: { status: 'expired' },
    });
    if (marked.count === 0 || entry.offerExpiresAt === null) continue;
    await notifyOffer(client, {
      session: input.session,
      recipientMembershipId: entry.clientMembershipId,
      kind: 'waitlist_offer_expired',
      offerExpiresAt: entry.offerExpiresAt,
    });
  }
}

/** Ofrece las plazas libres a quien lleva más tiempo esperando. */
async function offerFreeSeats(
  client: TenantTransactionClient,
  input: { session: SessionToAdvance; now: Date },
): Promise<void> {
  const { session } = input;
  const [bookedCount, activeOfferCount] = await Promise.all([
    client.booking.count({ where: { classSessionId: session.id, status: { not: 'cancelled' } } }),
    client.waitlistEntry.count({
      where: { classSessionId: session.id, status: 'offered', offerExpiresAt: { gt: input.now } },
    }),
  ]);
  const seats = countOfferableSeats({
    capacity: session.capacity,
    bookedCount,
    activeOfferCount,
  });
  if (seats === 0) return;
  const next = await client.waitlistEntry.findMany({
    where: { classSessionId: session.id, status: 'waiting' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: seats,
  });
  const offerExpiresAt = computeOfferExpiry(input.now);
  for (const entry of next) {
    await client.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: 'offered', offeredAt: input.now, offerExpiresAt },
    });
    await notifyOffer(client, {
      session,
      recipientMembershipId: entry.clientMembershipId,
      kind: 'waitlist_offer',
      offerExpiresAt,
    });
  }
}

/**
 * Pone al día la espera de una clase: caduca las ofertas vencidas y ofrece las plazas libres a quien
 * espera. Una clase que ya no admite reservas (cancelada, empezada o no grupal) cierra su espera.
 * Va con el mismo cerrojo de plazas que las reservas, así nadie se cuela entre medias.
 */
export async function advanceSessionWaitlist(
  client: TenantTransactionClient,
  input: { classSessionId: string; now: Date },
): Promise<void> {
  await lockSessionSeats(client, input.classSessionId);
  const session = await client.classSession.findUnique({
    where: { id: input.classSessionId },
    select: {
      id: true,
      centerId: true,
      capacity: true,
      startsAt: true,
      status: true,
      mode: true,
      service: { select: { name: true } },
    },
  });
  if (!session) return;
  const isBookable =
    session.status === 'scheduled' &&
    session.mode === 'group' &&
    session.startsAt.getTime() > input.now.getTime();
  if (!isBookable) {
    await client.waitlistEntry.updateMany({
      where: { classSessionId: session.id, status: { in: ['waiting', 'offered'] } },
      data: { status: 'expired' },
    });
    return;
  }
  await expireStaleOffers(client, { session, now: input.now });
  await offerFreeSeats(client, { session, now: input.now });
}
