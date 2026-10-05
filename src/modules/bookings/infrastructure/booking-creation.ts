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
} from '../application/ports/booking.repository';
import { toBookingView, WITH_SESSION_DETAILS } from './booking-view.mapper';

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

async function hasOverlappingBooking(
  client: TenantTransactionClient,
  input: { clientMembershipId: string; startsAt: Date; endsAt: Date },
): Promise<boolean> {
  const overlappingBooking = await client.booking.findFirst({
    where: {
      clientMembershipId: input.clientMembershipId,
      status: 'confirmed',
      classSession: {
        status: 'scheduled',
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
    },
    select: { id: true },
  });
  return overlappingBooking !== null;
}

interface NewSession {
  readonly id: string;
  readonly centerId: string;
  readonly serviceId: string;
  readonly staffMembershipId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Inserta la sesión; si la persona del equipo ya tiene otra programada que se solapa, la restricción
 * EXCLUDE lo impide y `ON CONFLICT DO NOTHING` lo convierte en "no se insertó nada" (sin abortar la transacción).
 */
async function tryInsertSession(
  client: TenantTransactionClient,
  session: NewSession,
): Promise<boolean> {
  const inserted = await client.$queryRaw<{ id: string }[]>`
    insert into class_sessions (id, center_id, service_id, staff_membership_id, starts_at, ends_at)
    values (${session.id}::uuid, ${session.centerId}::uuid, ${session.serviceId}::uuid,
            ${session.staffMembershipId}::uuid, ${session.startsAt}::timestamptz,
            ${session.endsAt}::timestamptz)
    on conflict do nothing
    returning id`;
  return inserted.length === 1;
}

/**
 * Prueba con cada persona libre a esa hora, la preferida primero. Si otra petición se lleva a la
 * primera entre el cálculo y la inserción, se intenta con la siguiente; si no queda nadie, el hueco
 * ya no existe.
 */
async function insertSessionAndBooking(
  client: TenantTransactionClient,
  input: {
    actor: ActorContext;
    command: CreateBookingCommand;
    service: SchedulableService;
    endsAt: Date;
    freeStaff: readonly StaffCandidate[];
  },
): Promise<CreateBookingOutcome> {
  const { actor, command } = input;
  for (const staffMember of input.freeStaff) {
    const session = {
      id: generateUuidV7(),
      centerId: actor.centerId,
      serviceId: input.service.id,
      staffMembershipId: staffMember.membershipId,
      startsAt: command.startsAt,
      endsAt: input.endsAt,
    };
    if (!(await tryInsertSession(client, session))) continue;
    const booking = await client.booking.create({
      data: {
        id: generateUuidV7(),
        centerId: actor.centerId,
        classSessionId: session.id,
        clientMembershipId: actor.membershipId,
        status: 'confirmed',
        idempotencyKey: command.idempotencyKey,
      },
      include: WITH_SESSION_DETAILS,
    });
    return { kind: 'created', booking: toBookingView(booking) };
  }
  return { kind: 'slot_unavailable' };
}

export async function createBookingInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: CreateBookingCommand,
): Promise<CreateBookingOutcome> {
  await lockClientBookings(client, actor.membershipId);
  const facts = await loadSchedulingFacts(client, {
    serviceId: command.serviceId,
    canSeeHiddenService: false,
    dateRange: { aroundInstant: command.startsAt },
  });
  if (!facts) return { kind: 'service_not_found' };

  const decision = findBookableSlot({
    scheduling: { ...facts, ...facts.service, now: command.now },
    startsAt: command.startsAt,
    preferredStaffMembershipId: command.preferredStaffMembershipId,
  });
  if (decision.kind === 'outside_window') return decision;

  const endsAt = addMinutes(command.startsAt, facts.service.durationMinutes);
  const isClientBusy = await hasOverlappingBooking(client, {
    clientMembershipId: actor.membershipId,
    startsAt: command.startsAt,
    endsAt,
  });
  if (isClientBusy) return { kind: 'already_booked' };
  if (decision.kind === 'slot_unavailable') return decision;

  return insertSessionAndBooking(client, {
    actor,
    command,
    service: facts.service,
    endsAt,
    freeStaff: decision.slot.freeStaff,
  });
}
