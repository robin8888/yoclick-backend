import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { buildPage, type Page } from '../../../shared/pagination/build-page';
import { decodeCursor } from '../../../shared/pagination/cursor';
import { z } from 'zod';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { buildStudentCode, STUDENT_CODE_RANGE } from '../domain/student-code';
import {
  type VoiceAdminRepository,
  type VoiceCallListItem,
  type VoiceConfigPatch,
  type VoiceDeprovisioningFacts,
  type VoiceEnableOutcome,
  type VoiceOverview,
  type VoiceProvisioning,
  type VoiceProvisioningBillingFacts,
  type VoiceUsageView,
} from '../application/ports/voice-admin.repository';
import { type VoiceAgentConfigView } from '../application/ports/voice-call.repository';
import { addMonthsToInstant } from '../../../shared/time/add-months';
import { resolveUsagePeriodStart } from '../domain/usage-minutes';
import { toVoiceAgentConfigView } from './prisma-voice-call.repository';

const MAX_STUDENT_CODE_ATTEMPTS = 10;
const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 30;

const callCursorSchema = z.strictObject({ startedAt: z.coerce.date(), id: z.uuid() });

/** Prisma distingue «no tocar» de «dejar en blanco»: lo que no viaja en el cambio se quita antes de guardar. */
function keepDefinedFields(patch: VoiceConfigPatch): Prisma.VoiceAgentConfigUncheckedUpdateInput {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

function toCallListItem(
  row: {
    id: string;
    callerPhone: string;
    callerMembershipId: string | null;
    startedAt: Date;
    durationSeconds: number | null;
    outcome: VoiceCallListItem['outcome'];
    summary: string | null;
    estimatedCostCents: number | null;
    transcript: string | null;
  },
  names: ReadonlyMap<string, string>,
): VoiceCallListItem {
  return {
    id: row.id,
    callerPhone: row.callerPhone,
    callerName:
      row.callerMembershipId === null ? null : (names.get(row.callerMembershipId) ?? null),
    startedAt: row.startedAt,
    durationSeconds: row.durationSeconds,
    outcome: row.outcome,
    summary: row.summary,
    estimatedCostCents: row.estimatedCostCents,
    hasTranscript: row.transcript !== null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class PrismaVoiceAdminRepository implements VoiceAdminRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async getOverview(actor: ActorContext): Promise<VoiceOverview | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findUnique({
        where: { id: actor.centerId },
        select: { planId: true, phone: true, isVoiceReceptionistEnabled: true },
      });
      if (center === null) return null;
      const [line, subscription, config, addonPlan] = await Promise.all([
        client.voicePhoneLine.findUnique({ where: { centerId: actor.centerId } }),
        client.voiceReceptionistSubscription.findUnique({ where: { centerId: actor.centerId } }),
        client.voiceAgentConfig.findUnique({ where: { centerId: actor.centerId } }),
        client.voiceAddonPlan.findUnique({ where: { planId: center.planId } }),
      ]);
      return {
        planId: center.planId,
        isEnabled: center.isVoiceReceptionistEnabled,
        centerPhone: center.phone,
        line:
          line === null
            ? null
            : {
                phoneNumber: line.phoneNumber,
                provider: line.provider,
                isActive: line.status === 'active',
              },
        subscription:
          subscription === null
            ? null
            : {
                status: subscription.status,
                includedMinutes: subscription.includedMinutes,
                periodStart: subscription.periodStart,
                periodEnd: subscription.periodEnd,
              },
        config: config === null ? null : toVoiceAgentConfigView(config),
        addonPlan,
      };
    });
  }

  async saveConfig(actor: ActorContext, patch: VoiceConfigPatch): Promise<VoiceAgentConfigView> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const changes = keepDefinedFields(patch);
      const row = await client.voiceAgentConfig.upsert({
        where: { centerId: actor.centerId },
        create: {
          ...(changes as Prisma.VoiceAgentConfigUncheckedCreateInput),
          centerId: actor.centerId,
        },
        update: changes,
      });
      return toVoiceAgentConfigView(row);
    });
  }

  async setEnabled(actor: ActorContext, isEnabled: boolean): Promise<VoiceEnableOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if (isEnabled) {
        const [subscription, line] = await Promise.all([
          client.voiceReceptionistSubscription.findUnique({ where: { centerId: actor.centerId } }),
          client.voicePhoneLine.findUnique({ where: { centerId: actor.centerId } }),
        ]);
        if (subscription === null || subscription.status !== 'active') {
          return { kind: 'no_subscription' };
        }
        if (line === null) return { kind: 'no_phone_line' };
      }
      await client.center.update({
        where: { id: actor.centerId },
        data: { isVoiceReceptionistEnabled: isEnabled },
      });
      return { kind: 'changed' };
    });
  }

  async listCalls(
    actor: ActorContext,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<Page<VoiceCallListItem>> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const position =
        query.cursor === undefined ? null : decodeCursor(query.cursor, callCursorSchema);
      const rows = await client.voiceCallLog.findMany({
        where:
          position === null
            ? {}
            : {
                OR: [
                  { startedAt: { lt: position.startedAt } },
                  { startedAt: position.startedAt, id: { lt: position.id } },
                ],
              },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const names = await this.readCallerNames(
        client,
        rows.flatMap((row) => (row.callerMembershipId === null ? [] : [row.callerMembershipId])),
      );
      const items = rows.map((row) => toCallListItem(row, names));
      return buildPage({
        fetchedRows: items,
        limit: query.limit,
        toPosition: (last) => ({ startedAt: last.startedAt, id: last.id }),
      });
    });
  }

  async getUsage(actor: ActorContext, now: Date): Promise<VoiceUsageView | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const subscription = await client.voiceReceptionistSubscription.findUnique({
        where: { centerId: actor.centerId },
      });
      if (subscription === null) return null;
      const periodStart = resolveUsagePeriodStart(now, subscription);
      const usage = await client.voiceUsagePeriod.findUnique({
        where: { centerId_periodStart: { centerId: actor.centerId, periodStart } },
      });
      return {
        periodStart,
        usedMinutes: usage?.minutesUsed ?? 0,
        includedMinutes: subscription.includedMinutes,
      };
    });
  }

  async ensureStudentCode(actor: ActorContext): Promise<string | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const membership = await client.membership.findFirst({
        where: { id: actor.membershipId, centerId: actor.centerId, role: 'client' },
        select: { studentCode: true },
      });
      if (membership === null) return null;
      if (membership.studentCode !== null) return membership.studentCode;
      return this.assignFreshStudentCode(client, actor);
    });
  }

  async provisionCenter(
    actor: PlatformActorContext,
    provisioning: VoiceProvisioning,
    now: Date,
  ): Promise<boolean> {
    try {
      return await this.tenantPrismaService.runInPlatformContext(actor, (client) =>
        this.writeProvisioning(client, provisioning, now),
      );
    } catch (error) {
      // El número puente es único en toda la plataforma: otro centro ya lo tiene.
      if (isUniqueViolation(error)) throw new DomainError('CONFLICT', HTTP_STATUS.conflict);
      throw error;
    }
  }

  async readProvisioningBillingFacts(
    actor: PlatformActorContext,
    centerId: string,
  ): Promise<VoiceProvisioningBillingFacts | null> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const center = await client.center.findUnique({
        where: { id: centerId },
        select: { planId: true, billingPeriod: true, stripeSubscriptionId: true },
      });
      if (center === null) return null;
      const [plan, addonPlan] = await Promise.all([
        client.platformPlan.findUnique({
          where: { id: center.planId },
          select: { stripeTaxRateId: true },
        }),
        client.voiceAddonPlan.findUnique({ where: { planId: center.planId } }),
      ]);
      return {
        planId: center.planId,
        billingPeriod: center.billingPeriod === 'annual' ? 'annual' : 'monthly',
        stripeSubscriptionId: center.stripeSubscriptionId,
        taxRateId: plan?.stripeTaxRateId ?? null,
        monthlyPriceId: addonPlan?.stripeMonthlyPriceId ?? null,
        overagePriceId: addonPlan?.stripeOveragePriceId ?? null,
      };
    });
  }

  async readDeprovisioningFacts(
    actor: PlatformActorContext,
    centerId: string,
  ): Promise<VoiceDeprovisioningFacts | null> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const subscription = await client.voiceReceptionistSubscription.findUnique({
        where: { centerId },
        select: { stripeSubscriptionItemId: true, stripeOverageItemId: true },
      });
      if (subscription === null) return null;
      return {
        itemId: subscription.stripeSubscriptionItemId,
        overageItemId: subscription.stripeOverageItemId,
      };
    });
  }

  async deprovisionCenter(actor: PlatformActorContext, centerId: string): Promise<boolean> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const result = await client.voiceReceptionistSubscription.updateMany({
        where: { centerId },
        data: { status: 'cancelled', stripeSubscriptionItemId: null, stripeOverageItemId: null },
      });
      if (result.count === 0) return false;
      await client.center.update({
        where: { id: centerId },
        data: { isVoiceReceptionistEnabled: false },
      });
      return true;
    });
  }

  async clearExpiredTranscripts(now: Date): Promise<number> {
    return this.tenantPrismaService.runInVoiceRetentionSweepContext(
      (client) =>
        client.$executeRaw`
        update "voice_call_logs" as log
        set "transcript" = null
        where log."transcript" is not null
          and log."started_at" < ${now}::timestamptz - make_interval(days => coalesce(
            (select config."transcript_retention_days" from "voice_agent_configs" as config
              where config."center_id" = log."center_id"),
            ${DEFAULT_TRANSCRIPT_RETENTION_DAYS}))`,
    );
  }

  private async readCallerNames(
    client: TenantTransactionClient,
    membershipIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (membershipIds.length === 0) return new Map();
    const members = await client.membership.findMany({
      where: { id: { in: [...membershipIds] } },
      select: { id: true, user: { select: { fullName: true } } },
    });
    return new Map(members.map((member) => [member.id, member.user.fullName]));
  }

  private async assignFreshStudentCode(
    client: TenantTransactionClient,
    actor: ActorContext,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_STUDENT_CODE_ATTEMPTS; attempt += 1) {
      const code = buildStudentCode(randomInt(STUDENT_CODE_RANGE));
      const taken = await client.membership.count({
        where: { centerId: actor.centerId, studentCode: code },
      });
      if (taken > 0) continue;
      const updated = await client.membership.updateMany({
        where: { id: actor.membershipId, studentCode: null },
        data: { studentCode: code },
      });
      if (updated.count === 1) return code;
      // Otra petición de la misma persona se adelantó: se devuelve el código que quedó.
      const current = await client.membership.findUnique({
        where: { id: actor.membershipId },
        select: { studentCode: true },
      });
      return current?.studentCode ?? null;
    }
    return null;
  }

  private async writeProvisioning(
    client: TenantTransactionClient,
    provisioning: VoiceProvisioning,
    now: Date,
  ): Promise<boolean> {
    const center = await client.center.findUnique({
      where: { id: provisioning.centerId },
      select: { planId: true },
    });
    if (center === null) return false;
    const addonPlan = await client.voiceAddonPlan.findUnique({ where: { planId: center.planId } });
    if (addonPlan === null) return false;

    await this.upsertProvisionedRows(client, {
      provisioning,
      includedMinutes: provisioning.includedMinutes ?? addonPlan.includedMinutes,
      now,
    });
    return true;
  }

  private async upsertProvisionedRows(
    client: TenantTransactionClient,
    input: { provisioning: VoiceProvisioning; includedMinutes: number; now: Date },
  ): Promise<void> {
    const { provisioning, includedMinutes, now } = input;
    const { centerId } = provisioning;
    await client.voicePhoneLine.upsert({
      where: { centerId },
      create: {
        id: generateUuidV7(),
        centerId,
        phoneNumber: provisioning.bridgeNumber,
        provider: provisioning.provider,
      },
      update: { phoneNumber: provisioning.bridgeNumber, provider: provisioning.provider },
    });
    await this.upsertSubscription(client, { provisioning, includedMinutes, now });
    await client.voiceAgentConfig.upsert({
      where: { centerId },
      create: { centerId },
      update: {},
    });
  }

  private async upsertSubscription(
    client: TenantTransactionClient,
    input: { provisioning: VoiceProvisioning; includedMinutes: number; now: Date },
  ): Promise<void> {
    const { provisioning, includedMinutes, now } = input;
    const { centerId, billing } = provisioning;
    const period = {
      periodStart: billing?.periodStart ?? now,
      periodEnd: billing?.periodEnd ?? addMonthsToInstant(now, 1),
    };
    const stripeItems =
      billing === undefined
        ? {}
        : { stripeSubscriptionItemId: billing.itemId, stripeOverageItemId: billing.overageItemId };
    await client.voiceReceptionistSubscription.upsert({
      where: { centerId },
      create: {
        id: generateUuidV7(),
        centerId,
        includedMinutes,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        ...stripeItems,
      },
      // Sin cobro por Stripe (centro piloto) el periodo de un alta ya hecha no se toca.
      update: {
        includedMinutes,
        status: 'active',
        ...(billing === undefined ? {} : { ...period, ...stripeItems }),
      },
    });
  }
}
