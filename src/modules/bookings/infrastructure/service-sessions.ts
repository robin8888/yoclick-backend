import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import {
  type ServiceSessionsQuery,
  type ServiceSessionsView,
  type ServiceSessionView,
} from '../application/ports/booking.repository';

/** Cuántas clases futuras se miran para sugerir «la próxima con plazas» fuera del rango pedido. */
const NEXT_OPEN_LOOKUP_LIMIT = 60;

const SESSION_INCLUDE = {
  room: { select: { id: true, name: true } },
  staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
  schedule: { select: { label: true } },
  _count: { select: { bookings: { where: { status: { not: 'cancelled' } } } } },
} as const;

type StoredSession = Awaited<ReturnType<typeof findSessions>>[number];

async function findSessions(
  client: TenantTransactionClient,
  where: { serviceId: string; startsAt: { gte: Date; lt?: Date } },
  limit?: number,
) {
  return client.classSession.findMany({
    where: { ...where, status: 'scheduled' },
    include: SESSION_INCLUDE,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    ...(limit === undefined ? {} : { take: limit }),
  });
}

function toView(session: StoredSession): ServiceSessionView {
  const bookedCount = session._count.bookings;
  return {
    id: session.id,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    mode: session.mode,
    capacity: session.capacity,
    bookedCount,
    remainingSeats: Math.max(session.capacity - bookedCount, 0),
    room: session.room,
    teacher: {
      membershipId: session.staffMembership.id,
      fullName: session.staffMembership.user.fullName,
    },
    label: session.schedule?.label ?? null,
  };
}

/**
 * Las clases de un servicio con plazas libres entre dos fechas, y la próxima con plazas aunque caiga
 * fuera del rango: con eso se ofrecen los días y las horas en que de verdad se puede apuntar a
 * alguien, y se sugiere una fecha cuando no hay nada ese día.
 */
export async function listServiceSessionsInTransaction(
  client: TenantTransactionClient,
  query: ServiceSessionsQuery,
): Promise<ServiceSessionsView | null> {
  const service = await client.service.findFirst({
    where: { id: query.serviceId, archivedAt: null },
    select: { id: true },
  });
  if (!service) return null;
  const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
  const range = getUtcRangeOfLocalDates(query.fromDate, query.toDate, center.timezone);
  const from = range.startsAt > query.now ? range.startsAt : query.now;
  const isScheduled =
    (await client.sessionSchedule.count({
      where: { serviceId: query.serviceId, status: 'active' },
    })) > 0;

  const inRange = (
    await findSessions(client, {
      serviceId: query.serviceId,
      startsAt: { gte: from, lt: range.endsAt },
    })
  )
    .map(toView)
    .filter((session) => session.remainingSeats > 0);
  const upcoming = (
    await findSessions(
      client,
      { serviceId: query.serviceId, startsAt: { gte: query.now } },
      NEXT_OPEN_LOOKUP_LIMIT,
    )
  )
    .map(toView)
    .find((session) => session.remainingSeats > 0);

  return {
    timeZone: center.timezone,
    isScheduled,
    sessions: inRange,
    nextOpenStartsAt: upcoming?.startsAt ?? null,
  };
}
