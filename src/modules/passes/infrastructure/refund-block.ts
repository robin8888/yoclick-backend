import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { isBookingBlockedByRefund } from '../domain/refund-block';
import { resolvePassStatus } from '../domain/pass-rules';

export interface BookingForRefundBlock {
  readonly id: string;
  readonly clientMembershipId: string;
  readonly createdAt: Date;
  readonly status: string;
  readonly source: 'single' | 'enrollment';
}

interface ClientRefundFacts {
  hasValidPass: boolean;
  refundedPassCancelledAt: Date[];
}

/** Por cada persona: si tiene un bono válido y cuándo se le anularon bonos reembolsados por completo. */
async function loadClientRefundFacts(
  client: TenantTransactionClient,
  input: { clientMembershipIds: readonly string[]; now: Date },
): Promise<Map<string, ClientRefundFacts>> {
  const passes = await client.clientPass.findMany({
    where: {
      clientMembershipId: { in: [...input.clientMembershipIds] },
      OR: [{ status: 'active' }, { refundedAt: { not: null } }],
    },
    select: {
      clientMembershipId: true,
      status: true,
      remainingSessions: true,
      expiresAt: true,
      refundedAt: true,
    },
  });
  const factsByClient = new Map<string, ClientRefundFacts>();
  for (const pass of passes) {
    const facts = factsByClient.get(pass.clientMembershipId) ?? {
      hasValidPass: false,
      refundedPassCancelledAt: [],
    };
    if (resolvePassStatus(pass, input.now) === 'active') facts.hasValidPass = true;
    if (pass.refundedAt !== null) facts.refundedPassCancelledAt.push(pass.refundedAt);
    factsByClient.set(pass.clientMembershipId, facts);
  }
  return factsByClient;
}

/**
 * Las citas, de las dadas, que quedan bloqueadas por un reembolso total (ver
 * `isBookingBlockedByRefund`). Una sola consulta de bonos para todas.
 */
export async function findBookingsBlockedByRefund(
  client: TenantTransactionClient,
  input: { bookings: readonly BookingForRefundBlock[]; now: Date },
): Promise<Set<string>> {
  const candidates = input.bookings.filter(
    ({ status, source }) => status === 'confirmed' && source === 'single',
  );
  if (candidates.length === 0) return new Set();
  const factsByClient = await loadClientRefundFacts(client, {
    clientMembershipIds: [
      ...new Set(candidates.map(({ clientMembershipId }) => clientMembershipId)),
    ],
    now: input.now,
  });
  const blocked = candidates.filter((booking) => {
    const facts = factsByClient.get(booking.clientMembershipId);
    return (
      facts !== undefined &&
      isBookingBlockedByRefund({
        bookingCreatedAt: booking.createdAt,
        bookingStatus: booking.status,
        bookingSource: booking.source,
        hasValidPass: facts.hasValidPass,
        refundedPassCancelledAt: facts.refundedPassCancelledAt,
      })
    );
  });
  return new Set(blocked.map(({ id }) => id));
}
