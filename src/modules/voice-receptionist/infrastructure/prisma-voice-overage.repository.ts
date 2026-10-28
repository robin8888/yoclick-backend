import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import {
  type ReportableVoiceOverage,
  type VoiceOverageRepository,
} from '../application/ports/voice-overage.repository';

/** Stripe solo admite eventos de uso de los últimos 35 días: lo más viejo ya no se puede comunicar. */
const MAX_REPORTABLE_AGE_DAYS = 34;

const REPORTABLE_SELECT = {
  id: true,
  centerId: true,
  overageMinutes: true,
  endedAt: true,
  center: { select: { stripeCustomerId: true } },
} satisfies Prisma.VoiceCallLogSelect;

type ReportableRow = Prisma.VoiceCallLogGetPayload<{ select: typeof REPORTABLE_SELECT }>;

function toReportable(row: ReportableRow): ReportableVoiceOverage | null {
  const { stripeCustomerId } = row.center;
  if (stripeCustomerId === null || row.endedAt === null) return null;
  return {
    callLogId: row.id,
    centerId: row.centerId,
    stripeCustomerId,
    minutes: row.overageMinutes,
    endedAt: row.endedAt,
  };
}

function buildReportableFilter(now: Date): Prisma.VoiceCallLogWhereInput {
  return {
    overageMinutes: { gt: 0 },
    overageReportedAt: null,
    endedAt: { gte: new Date(now.getTime() - MAX_REPORTABLE_AGE_DAYS * MILLISECONDS_PER_DAY) },
    center: {
      stripeCustomerId: { not: null },
      voiceSubscription: { is: { stripeOverageItemId: { not: null } } },
    },
  };
}

@Injectable()
export class PrismaVoiceOverageRepository implements VoiceOverageRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findReportableCall(callLogId: string, now: Date): Promise<ReportableVoiceOverage | null> {
    return this.tenantPrismaService.runInBillingContext(async (client) => {
      const row = await client.voiceCallLog.findFirst({
        where: { id: callLogId, ...buildReportableFilter(now) },
        select: REPORTABLE_SELECT,
      });
      return row === null ? null : toReportable(row);
    });
  }

  async listReportableCalls(now: Date, limit: number): Promise<ReportableVoiceOverage[]> {
    return this.tenantPrismaService.runInBillingContext(async (client) => {
      const rows = await client.voiceCallLog.findMany({
        where: buildReportableFilter(now),
        orderBy: { endedAt: 'asc' },
        take: limit,
        select: REPORTABLE_SELECT,
      });
      return rows.flatMap((row) => toReportable(row) ?? []);
    });
  }

  async markReported(callLogId: string, reportedAt: Date): Promise<boolean> {
    return this.tenantPrismaService.runInBillingContext(async (client) => {
      const result = await client.voiceCallLog.updateMany({
        where: { id: callLogId, overageReportedAt: null },
        data: { overageReportedAt: reportedAt },
      });
      return result.count === 1;
    });
  }
}
