import { requireTeacher } from './require-teacher';
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
    where: { ...where, status: 'scheduled', staffMembershipId: { not: null } },
    include: SESSION_INCLUDE,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    ...(limit === undefined ? {} : { take: limit }),
  });
}

function toView(session: StoredSession, heldSeatCount: number): ServiceSessionView {
  // Las plazas ofrecidas a quien espera no se pueden reservar mientras dure su oferta.
  const bookedCount = session._count.bookings + heldSeatCount;
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
      membershipId: requireTeacher(session.staffMembership).id,
      fullName: requireTeacher(session.staffMembership).user.fullName,
    },
    label: session.schedule?.label ?? null,
  };
}

/** Cuántas plazas de cada clase están ofrecidas ahora mismo a alguien de la lista de espera. */
async function countHeldSeats(
  client: TenantTransactionClient,
  input: { sessionIds: readonly string[]; now: Date },
): Promise<Map<string, number>> {
  if (input.sessionIds.length === 0) return new Map();
  const groups = await client.waitlistEntry.groupBy({
    by: ['classSessionId'],
    where: {
      classSessionId: { in: [...input.sessionIds] },
      status: 'offered',
      offerExpiresAt: { gt: input.now },
    },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.classSessionId, group._count._all]));
}

async function toViews(
  client: TenantTransactionClient,
  input: { sessions: readonly StoredSession[]; now: Date },
): Promise<ServiceSessionView[]> {
  const held = await countHeldSeats(client, {
    sessionIds: input.sessions.map(({ id }) => id),
    now: input.now,
  });
  return input.sessions.map((session) => toView(session, held.get(session.id) ?? 0));
}

/** Las clases del rango pedido (las llenas solo si se piden) y la próxima con plazas, esté donde esté. */
async function findOpenSessions(
  client: TenantTransactionClient,
  input: { query: ServiceSessionsQuery; range: { startsAt: Date; endsAt: Date } },
): Promise<{ inRange: ServiceSessionView[]; upcoming: ServiceSessionView | undefined }> {
  const { query, range } = input;
  const inRangeSessions = await toViews(client, {
    sessions: await findSessions(client, {
      serviceId: query.serviceId,
      startsAt: { gte: range.startsAt, lt: range.endsAt },
    }),
    now: query.now,
  });
  // Con `shouldIncludeFull` también salen las llenas: es lo que permite apuntarse a su lista de espera.
  const inRange = inRangeSessions.filter(
    (session) => query.shouldIncludeFull || session.remainingSeats > 0,
  );
  const upcoming = (
    await toViews(client, {
      sessions: await findSessions(
        client,
        { serviceId: query.serviceId, startsAt: { gte: query.now } },
        NEXT_OPEN_LOOKUP_LIMIT,
      ),
      now: query.now,
    })
  ).find((session) => session.remainingSeats > 0);
  return { inRange, upcoming };
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

  const { inRange, upcoming } = await findOpenSessions(client, {
    query,
    range: { startsAt: from, endsAt: range.endsAt },
  });

  return {
    timeZone: center.timezone,
    isScheduled,
    sessions: inRange,
    nextOpenStartsAt: upcoming?.startsAt ?? null,
  };
}
