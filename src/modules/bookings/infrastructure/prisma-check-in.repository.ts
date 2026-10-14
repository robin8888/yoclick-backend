import { Injectable } from '@nestjs/common';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import {
  type CheckInOutcome,
  type CheckInRepository,
} from '../application/ports/check-in.repository';
import { CHECKIN_EARLY_MINUTES, pickBookingToCheckIn } from '../domain/check-in';
import { decidePassAccess, type PassAccessDecision } from '../../passes/domain/pass-access';
import { settleEndedBookings } from '../../passes/infrastructure/no-show-settlement';
import { consumePassForBooking } from '../../passes/infrastructure/pass-consumption';
import { toBookingView, WITH_SESSION_DETAILS } from './booking-view.mapper';

type CheckInCommand = { clientMembershipId: string; now: Date };

/** Las confirmadas de la clienta que podrían estar en su ventana de ahora (el personal, solo las suyas). */
async function findCheckInCandidates(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: CheckInCommand,
): Promise<ReturnType<typeof pickBookingToCheckIn>> {
  const earliestStart = new Date(
    command.now.getTime() + CHECKIN_EARLY_MINUTES * MILLISECONDS_PER_MINUTE,
  );
  const bookings = await client.booking.findMany({
    where: {
      clientMembershipId: command.clientMembershipId,
      status: 'confirmed',
      classSession: {
        startsAt: { lte: earliestStart },
        endsAt: { gte: command.now },
        ...(actor.role === 'staff' && { staffMembershipId: actor.membershipId }),
      },
    },
    include: WITH_SESSION_DETAILS,
  });
  return pickBookingToCheckIn(
    bookings.map((booking) => ({
      bookingId: booking.id,
      status: booking.status,
      startsAt: booking.classSession.startsAt,
      endsAt: booking.classSession.endsAt,
    })),
    command.now,
  );
}

async function decideClientAccess(
  client: TenantTransactionClient,
  command: CheckInCommand,
): Promise<PassAccessDecision> {
  // Las clases ya pasadas sin venir ni cancelar se descuentan antes de mirar el saldo.
  await settleEndedBookings(client, {
    now: command.now,
    clientMembershipId: command.clientMembershipId,
  });
  const [activeRateCount, passes] = await Promise.all([
    client.rate.count({ where: { archivedAt: null } }),
    client.clientPass.findMany({
      where: { clientMembershipId: command.clientMembershipId },
      select: {
        name: true,
        status: true,
        totalSessions: true,
        remainingSessions: true,
        expiresAt: true,
      },
    }),
  ]);
  return decidePassAccess({ passes, hasRates: activeRateCount > 0, now: command.now });
}

async function registerArrival(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: CheckInCommand & { bookingId: string },
) {
  // UPDATE condicionado a �a�n sin registrar�: dos escaneos a la vez no se pisan.
  const marked = await client.booking.updateMany({
    where: { id: command.bookingId, checkedInAt: null },
    data: { checkedInAt: command.now, checkedInByMembershipId: actor.membershipId },
  });
  // Llegar a clase es asistir: se descuenta del bono en la misma transacci�n que la llegada.
  if (marked.count === 1) {
    await consumePassForBooking(client, { bookingId: command.bookingId, now: command.now });
  }
  const stored = await client.booking.findUniqueOrThrow({
    where: { id: command.bookingId },
    include: WITH_SESSION_DETAILS,
  });
  return { stored, isFirstCheckIn: marked.count === 1 };
}

/**
 * Repetir el escaneo de una llegada ya registrada devuelve esa misma llegada aunque el descuento
 * haya dejado el bono a cero; sin llegada previa, sin acceso no se registra ni se descuenta nada.
 */
async function repeatedArrival(
  client: TenantTransactionClient,
  input: {
    picked: Awaited<ReturnType<typeof findCheckInCandidates>>;
    command: CheckInCommand;
    person: { clientMembershipId: string; clientFullName: string; photoKey: string | null };
  },
): Promise<CheckInOutcome | null> {
  if (!input.picked) return null;
  const stored = await client.booking.findFirst({
    where: { id: input.picked.bookingId, checkedInAt: { not: null } },
    include: WITH_SESSION_DETAILS,
  });
  if (!stored) return null;
  return {
    kind: 'already_checked_in',
    booking: toBookingView(stored),
    ...input.person,
    access: { isGranted: true, reason: 'valid_pass', pass: null },
    checkedInAt: stored.checkedInAt ?? input.command.now,
  };
}

@Injectable()
export class PrismaCheckInRepository implements CheckInRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async checkInClient(actor: ActorContext, command: CheckInCommand): Promise<CheckInOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const clientMembership = await client.membership.findFirst({
        where: { id: command.clientMembershipId, role: 'client', status: 'active' },
        select: { user: { select: { fullName: true, photoKey: true } } },
      });
      if (!clientMembership) return { kind: 'invalid_client' };
      const person = {
        clientMembershipId: command.clientMembershipId,
        clientFullName: clientMembership.user.fullName,
        photoKey: clientMembership.user.photoKey,
      };

      const access = await decideClientAccess(client, command);
      const picked = await findCheckInCandidates(client, actor, command);
      if (!access.isGranted) {
        return (
          (await repeatedArrival(client, { picked, command, person })) ?? {
            kind: 'not_checked_in',
            ...person,
            access,
          }
        );
      }
      if (!picked) return { kind: 'not_checked_in', ...person, access };

      const { stored, isFirstCheckIn } = await registerArrival(client, actor, {
        ...command,
        bookingId: picked.bookingId,
      });
      return {
        kind: isFirstCheckIn ? 'checked_in' : 'already_checked_in',
        booking: toBookingView(stored),
        ...person,
        access,
        checkedInAt: stored.checkedInAt ?? command.now,
      };
    });
  }
}
