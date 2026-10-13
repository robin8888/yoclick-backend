import { MILLISECONDS_PER_DAY, MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { addMinutes } from '../../../shared/time/zoned-time';
import { type SchedulableService } from '../../scheduling/application/ports/scheduling-facts.repository';
import { type StaffCandidate } from '../../scheduling/domain/available-slots';
import { findBookableSlot } from '../../scheduling/domain/find-bookable-slot';
import { loadSchedulingFacts } from '../../scheduling/infrastructure/scheduling-facts.loader';
import {
  type CreateBookingCommand,
  type CreateBookingOutcome,
  type JoinGroupSessionCommand,
  type JoinGroupSessionOutcome,
} from '../application/ports/booking.repository';
import { recordBookingNotification } from '../../notifications/infrastructure/booking-notification.recorder';
import { isRoomBlocked } from '../../schedules/infrastructure/room-block-queries';
import { isModeAllowedByService } from '../../schedules/domain/schedule-rules';
import { toBookingView, WITH_SESSION_DETAILS } from './booking-view.mapper';
import { hasOverlappingBooking } from './client-overlap';
import { listUsableRooms, type UsableRoom } from './usable-rooms';

/**
 * Serializa las reservas de una misma persona: dos peticiones suyas a la vez (por ejemplo, dos
 * toques seguidos con claves distintas) no pueden saltarse la comprobación de "ya tienes otra cita".
 * El bloqueo se libera solo al terminar la transacción. El de la persona del equipo no hace falta:
 * lo garantiza la restricción EXCLUDE de la base de datos.
 */
async function lockClientBookings(
  client: TenantTransactionClient,
  clientMembershipId: string,
): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${clientMembershipId}, 0))`;
}

/** Serializa el recuento de plazas de una clase grupal: nadie se pasa del aforo por llegar a la vez. */
async function lockSessionSeats(client: TenantTransactionClient, sessionId: string): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;
}

/** La RLS acota a este centro: un cliente de otro centro simplemente no se encuentra. */
async function isActiveClient(
  client: TenantTransactionClient,
  membershipId: string,
): Promise<boolean> {
  const count = await client.membership.count({
    where: { id: membershipId, role: 'client', status: 'active' },
  });
  return count === 1;
}

interface NewSession {
  readonly id: string;
  readonly centerId: string;
  readonly serviceId: string;
  readonly staffMembershipId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomId: string | null;
  readonly mode: 'private' | 'group';
  readonly capacity: number;
}

/**
 * Inserta la sesión; si la persona del equipo o la sala ya tienen otra programada que se solapa, la
 * restricción EXCLUDE lo impide y `ON CONFLICT DO NOTHING` lo convierte en "no se insertó nada" (sin
 * abortar la transacción). Una sala bloqueada (alquiler, mantenimiento) tampoco admite la sesión.
 */
async function tryInsertSession(
  client: TenantTransactionClient,
  session: NewSession,
): Promise<boolean> {
  if (
    session.roomId !== null &&
    (await isRoomBlocked(client, {
      roomId: session.roomId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
    }))
  ) {
    return false;
  }
  const inserted = await client.$queryRaw<{ id: string }[]>`
    insert into class_sessions
      (id, center_id, service_id, staff_membership_id, starts_at, ends_at, room_id, mode, capacity)
    values (${session.id}::uuid, ${session.centerId}::uuid, ${session.serviceId}::uuid,
            ${session.staffMembershipId}::uuid, ${session.startsAt}::timestamptz,
            ${session.endsAt}::timestamptz, ${session.roomId}::uuid,
            ${session.mode}::session_mode, ${session.capacity})
    on conflict do nothing
    returning id`;
  return inserted.length === 1;
}

interface NewBooking {
  readonly actor: ActorContext;
  readonly clientMembershipId: string;
  readonly idempotencyKey: string | null;
  readonly sessionId: string;
}

/** La reserva del cliente sobre la sesión (recién creada o la grupal a la que se apunta). */
async function insertBooking(client: TenantTransactionClient, input: NewBooking) {
  return client.booking.create({
    data: {
      id: generateUuidV7(),
      centerId: input.actor.centerId,
      classSessionId: input.sessionId,
      clientMembershipId: input.clientMembershipId,
      status: 'confirmed',
      idempotencyKey: input.idempotencyKey,
      // El servidor lo saca de quien hace la petición: la app nunca lo envía.
      createdByMembershipId: input.actor.membershipId,
      createdByRole: input.actor.role,
    },
    include: WITH_SESSION_DETAILS,
  });
}

interface BookingCreatedNotice {
  readonly actor: ActorContext;
  readonly clientMembershipId: string;
  readonly serviceName: string;
  readonly startsAt: Date;
  readonly booking: { readonly id: string; readonly staffMembershipId: string };
}

/** Avisa a quien da la cita y a administración de la nueva reserva. */
async function notifyBookingCreated(
  client: TenantTransactionClient,
  notice: BookingCreatedNotice,
): Promise<void> {
  await recordBookingNotification(client, {
    centerId: notice.actor.centerId,
    change: 'created',
    bookingId: notice.booking.id,
    clientMembershipId: notice.clientMembershipId,
    staffMembershipId: notice.booking.staffMembershipId,
    serviceName: notice.serviceName,
    startsAt: notice.startsAt,
    actorMembershipId: notice.actor.membershipId,
  });
}

export type SessionReservation =
  | {
      readonly kind: 'reserved';
      readonly sessionId: string;
      readonly staffMembershipId: string;
      readonly service: SchedulableService;
      readonly endsAt: Date;
    }
  | Exclude<
      CreateBookingOutcome,
      { readonly kind: 'created' } | { readonly kind: 'service_scheduled_only' }
    >;

type RoomChoice =
  | { readonly kind: 'rooms'; readonly rooms: readonly (UsableRoom | null)[] }
  | { readonly kind: 'unavailable' };

/**
 * Qué salas probar para una persona: la elegida si la hay (y la puede usar), si no las suyas y las
 * de nadie, la preferida primero. Un centro sin salas para ella no exige sala en una cita privada;
 * la grupal siempre la necesita porque su aforo es el de la sala.
 */
async function chooseRoomsToTry(
  client: TenantTransactionClient,
  input: {
    staffMembershipId: string;
    command: CreateBookingCommand;
    service: SchedulableService;
  },
): Promise<RoomChoice> {
  const { command } = input;
  const usable = await listUsableRooms(client, input.staffMembershipId, {
    serviceRoomId: input.service.roomId,
    serviceId: input.service.id,
  });
  if (command.roomId !== undefined && command.roomId !== null) {
    const chosen = usable.find((room) => room.id === command.roomId);
    return chosen ? { kind: 'rooms', rooms: [chosen] } : { kind: 'unavailable' };
  }
  const preferred = usable.filter((room) => room.id === command.preferredRoomId);
  const others = usable.filter((room) => room.id !== command.preferredRoomId);
  const ordered = [...preferred, ...others];
  if (ordered.length > 0) return { kind: 'rooms', rooms: ordered };
  return command.mode === 'group' ? { kind: 'unavailable' } : { kind: 'rooms', rooms: [null] };
}

interface SessionAttempt {
  readonly actor: ActorContext;
  readonly command: CreateBookingCommand;
  readonly service: SchedulableService;
  readonly endsAt: Date;
  readonly staffMembershipId: string;
}

type AttemptOutcome =
  | { readonly kind: 'reserved'; readonly sessionId: string }
  | { readonly kind: 'failed'; readonly hasRoomProblem: boolean };

/** Prueba con cada sala posible de una persona: la primera que no choque se queda la sesión. */
async function tryRoomsOfStaff(
  client: TenantTransactionClient,
  attempt: SessionAttempt,
): Promise<AttemptOutcome> {
  const { actor, command, service } = attempt;
  const choice = await chooseRoomsToTry(client, {
    staffMembershipId: attempt.staffMembershipId,
    command,
    service,
  });
  if (choice.kind === 'unavailable') return { kind: 'failed', hasRoomProblem: true };
  const mode = command.mode ?? 'private';
  let hasRoomProblem = false;
  for (const room of choice.rooms) {
    const session: NewSession = {
      id: generateUuidV7(),
      centerId: actor.centerId,
      serviceId: service.id,
      staffMembershipId: attempt.staffMembershipId,
      startsAt: command.startsAt,
      endsAt: attempt.endsAt,
      roomId: room?.id ?? null,
      mode,
      capacity: mode === 'group' && room !== null ? room.capacity : 1,
    };
    if (await tryInsertSession(client, session)) return { kind: 'reserved', sessionId: session.id };
    hasRoomProblem ||= room !== null;
  }
  return { kind: 'failed', hasRoomProblem };
}

/**
 * Prueba con cada persona libre a esa hora, la preferida primero, y con cada sala posible. Si otra
 * petición se lleva la primera entre el cálculo y la inserción, se intenta con la siguiente; si no
 * queda nadie, el hueco (o la sala) ya no existe.
 */
async function insertFirstFreeSession(
  client: TenantTransactionClient,
  input: {
    actor: ActorContext;
    command: CreateBookingCommand;
    service: SchedulableService;
    endsAt: Date;
    freeStaff: readonly StaffCandidate[];
  },
): Promise<SessionReservation> {
  let hasRoomProblem = false;
  for (const staffMember of input.freeStaff) {
    const outcome = await tryRoomsOfStaff(client, {
      ...input,
      staffMembershipId: staffMember.membershipId,
    });
    if (outcome.kind === 'reserved') {
      return {
        kind: 'reserved',
        sessionId: outcome.sessionId,
        staffMembershipId: staffMember.membershipId,
        service: input.service,
        endsAt: input.endsAt,
      };
    }
    hasRoomProblem ||= outcome.hasRoomProblem;
  }
  return { kind: hasRoomProblem ? 'room_unavailable' : 'slot_unavailable' };
}

type LoadedFacts = NonNullable<Awaited<ReturnType<typeof loadSchedulingFacts>>>;

/** Los datos del centro y del servicio, con la rejilla fina si la cita la pone el equipo. */
function buildSchedulingInput(facts: LoadedFacts, command: CreateBookingCommand) {
  return { ...facts, ...facts.service, stepMinutes: command.slotStepMinutes, now: command.now };
}

/**
 * Busca el hueco y crea la sesión (todavía sin reserva), comprobando que el cliente no tiene otra
 * cita a esa hora. Sirve tanto para reservar como para cambiar de hora una reserva existente.
 */
export async function reserveSessionInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: CreateBookingCommand,
): Promise<SessionReservation> {
  const clientMembershipId = command.clientMembershipId ?? actor.membershipId;
  await lockClientBookings(client, clientMembershipId);
  if (!(await isActiveClient(client, clientMembershipId))) return { kind: 'client_not_found' };
  const facts = await loadSchedulingFacts(client, {
    serviceId: command.serviceId,
    canSeeHiddenService: false,
    dateRange: { aroundInstant: command.startsAt },
  });
  if (!facts) return { kind: 'service_not_found' };
  if (!isModeAllowedByService(facts.service.mode, command.mode ?? 'private')) {
    return { kind: 'mode_not_allowed' };
  }

  const decision = findBookableSlot({
    scheduling: buildSchedulingInput(facts, command),
    startsAt: command.startsAt,
    preferredStaffMembershipId: command.preferredStaffMembershipId,
  });
  if (decision.kind === 'outside_window') return decision;

  const endsAt = addMinutes(command.startsAt, facts.service.durationMinutes);
  const isClientBusy = await hasOverlappingBooking(client, {
    clientMembershipId,
    startsAt: command.startsAt,
    endsAt,
  });
  if (isClientBusy) return { kind: 'already_booked' };
  if (decision.kind === 'slot_unavailable') return decision;

  return insertFirstFreeSession(client, {
    actor,
    command,
    service: facts.service,
    endsAt,
    freeStaff: decision.slot.freeStaff,
  });
}

export async function createBookingInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: CreateBookingCommand,
): Promise<CreateBookingOutcome> {
  if (await isOnlyGivenInSchedule(client, command.serviceId)) {
    return { kind: 'service_scheduled_only' };
  }
  const reservation = await reserveSessionInTransaction(client, actor, command);
  if (reservation.kind !== 'reserved') return reservation;
  const clientMembershipId = command.clientMembershipId ?? actor.membershipId;
  const booking = await insertBooking(client, {
    actor,
    clientMembershipId,
    idempotencyKey: command.idempotencyKey,
    sessionId: reservation.sessionId,
  });
  await notifyBookingCreated(client, {
    actor,
    clientMembershipId,
    serviceName: reservation.service.name,
    startsAt: command.startsAt,
    booking: { id: booking.id, staffMembershipId: reservation.staffMembershipId },
  });
  return { kind: 'created', booking: toBookingView(booking) };
}

/**
 * Un servicio con horario de sala vigente solo se da en sus clases: no se puede reservar en una
 * hora libre cualquiera. Un servicio sin horario sigue funcionando como siempre.
 */
async function isOnlyGivenInSchedule(
  client: TenantTransactionClient,
  serviceId: string,
): Promise<boolean> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const activeScheduleCount = await client.sessionSchedule.count({
    where: {
      serviceId,
      status: 'active',
      OR: [{ endsOn: null }, { endsOn: { gte: today } }],
    },
  });
  return activeScheduleCount > 0;
}

/** El servicio de la clase es visible y la clase cae dentro de su antelación mínima y su ventana. */
async function isOpenToClient(
  client: TenantTransactionClient,
  session: { serviceId: string; startsAt: Date },
  now: Date,
): Promise<boolean> {
  const service = await client.service.findFirst({
    where: { id: session.serviceId, archivedAt: null, isVisible: true },
    select: { minNoticeMinutes: true, bookingWindowDays: true },
  });
  if (!service) return false;
  const earliest = now.getTime() + service.minNoticeMinutes * MILLISECONDS_PER_MINUTE;
  const latest = now.getTime() + service.bookingWindowDays * MILLISECONDS_PER_DAY;
  const startsAt = session.startsAt.getTime();
  return startsAt >= earliest && startsAt <= latest;
}

async function findJoinableSession(
  client: TenantTransactionClient,
  command: JoinGroupSessionCommand,
) {
  return client.classSession.findFirst({
    where: {
      id: command.classSessionId,
      status: 'scheduled',
      startsAt: { gt: command.now },
    },
    include: { service: { select: { name: true } } },
  });
}

async function isSessionFull(
  client: TenantTransactionClient,
  session: { id: string; capacity: number },
): Promise<boolean> {
  const seatsTaken = await client.booking.count({
    where: { classSessionId: session.id, status: { not: 'cancelled' } },
  });
  return seatsTaken >= session.capacity;
}

/** Apunta a un cliente a una clase grupal que ya existe, si quedan plazas. */
export async function joinGroupSessionInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: JoinGroupSessionCommand,
): Promise<JoinGroupSessionOutcome> {
  await lockClientBookings(client, command.clientMembershipId);
  if (!(await isActiveClient(client, command.clientMembershipId))) {
    return { kind: 'client_not_found' };
  }
  await lockSessionSeats(client, command.classSessionId);
  const session = await findJoinableSession(client, command);
  if (!session) return { kind: 'session_not_found' };
  if (command.isClientBooking === true && !(await isOpenToClient(client, session, command.now))) {
    return { kind: 'outside_window' };
  }

  if (await isSessionFull(client, session)) return { kind: 'session_full' };
  const isClientBusy = await hasOverlappingBooking(client, {
    clientMembershipId: command.clientMembershipId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
  });
  if (isClientBusy) return { kind: 'already_booked' };

  const booking = await insertBooking(client, {
    actor,
    clientMembershipId: command.clientMembershipId,
    idempotencyKey: null,
    sessionId: session.id,
  });
  await notifyBookingCreated(client, {
    actor,
    clientMembershipId: command.clientMembershipId,
    serviceName: session.service.name,
    startsAt: session.startsAt,
    booking: { id: booking.id, staffMembershipId: session.staffMembershipId },
  });
  return { kind: 'created', booking: toBookingView(booking) };
}
