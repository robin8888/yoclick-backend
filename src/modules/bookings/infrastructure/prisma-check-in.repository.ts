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

@Injectable()
export class PrismaCheckInRepository implements CheckInRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async checkInClient(actor: ActorContext, command: CheckInCommand): Promise<CheckInOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const clientMembership = await client.membership.findFirst({
        where: { id: command.clientMembershipId, role: 'client', status: 'active' },
        select: { user: { select: { fullName: true } } },
      });
      if (!clientMembership) return { kind: 'invalid_client' };
      const picked = await findCheckInCandidates(client, actor, command);
      if (!picked) return { kind: 'no_booking' };

      // UPDATE condicionado a «aún sin registrar»: dos escaneos a la vez no se pisan.
      const marked = await client.booking.updateMany({
        where: { id: picked.bookingId, checkedInAt: null },
        data: { checkedInAt: command.now, checkedInByMembershipId: actor.membershipId },
      });
      const stored = await client.booking.findUniqueOrThrow({
        where: { id: picked.bookingId },
        include: WITH_SESSION_DETAILS,
      });
      return {
        kind: marked.count === 1 ? 'checked_in' : 'already_checked_in',
        booking: toBookingView(stored),
        clientFullName: clientMembership.user.fullName,
        checkedInAt: stored.checkedInAt ?? command.now,
      };
    });
  }
}
