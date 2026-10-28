import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { UNUSABLE_PASSWORD_HASH } from '../../../shared/auth/unactivated-account';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { mergeCallOutcomes, type VoiceCallOutcomeName } from '../domain/call-outcome';
import { type CodeAttemptState } from '../domain/code-attempts';
import { resolveFailureWindowStart } from '../domain/code-failure-cap';
import {
  calculateCallOverageMinutes,
  findCrossedUsageThresholds,
  resolveUsagePeriod,
  WARNING_PERCENT,
  type UsageAlertPercent,
} from '../domain/usage-minutes';
import { type VoiceCallEnd, type VoiceToolReply } from '../application/ports/voice-agent-provider';
import {
  type VoiceAgentConfigView,
  type VoiceCallerView,
  type VoiceCallFinishOutcome,
  type VoiceCallRepository,
  type VoiceCenterSnapshot,
  type VoiceLineView,
  type VoiceServiceView,
  type VoiceUsageAlertFacts,
  type VoiceUsageSnapshot,
} from '../application/ports/voice-call.repository';
import { buildVoiceSystemActor } from './voice-system-actor';

/** Dominio reservado (RFC 2606): el correo de un invitado nunca llega a nadie ni puede registrarse. */
const GUEST_EMAIL_DOMAIN = 'voice-guest.yoclick.invalid';

export function toVoiceAgentConfigView(row: {
  greeting: string | null;
  assistantName: string | null;
  voice: string | null;
  language: string;
  forwardingMode: VoiceAgentConfigView['forwardingMode'];
  humanTransferPhone: string | null;
  legalNotice: string | null;
  transcriptRetentionDays: number;
  overagePolicy: VoiceAgentConfigView['overagePolicy'];
}): VoiceAgentConfigView {
  return {
    greeting: row.greeting,
    assistantName: row.assistantName,
    voice: row.voice,
    language: row.language,
    forwardingMode: row.forwardingMode,
    humanTransferPhone: row.humanTransferPhone,
    legalNotice: row.legalNotice,
    transcriptRetentionDays: row.transcriptRetentionDays,
    overagePolicy: row.overagePolicy,
  };
}

function toCallerView(row: {
  id: string;
  userId: string;
  joinSource: string | null;
  user: { fullName: string; phone: string | null };
}): VoiceCallerView {
  return {
    membershipId: row.id,
    userId: row.userId,
    firstName: row.user.fullName.trim().split(/\s+/)[0] ?? '',
    isGuest: row.joinSource === 'voice_guest',
    storedPhone: row.user.phone,
  };
}

const CALLER_SELECT = {
  id: true,
  userId: true,
  joinSource: true,
  user: { select: { fullName: true, phone: true } },
} as const;

@Injectable()
export class PrismaVoiceCallRepository implements VoiceCallRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findLineByNumber(calledNumber: string): Promise<VoiceLineView | null> {
    return this.tenantPrismaService.runInVoiceLineLookupContext(calledNumber, async (client) => {
      const line = await client.voicePhoneLine.findFirst({
        where: { phoneNumber: calledNumber },
        select: { centerId: true, status: true },
      });
      return line === null ? null : { centerId: line.centerId, isActive: line.status === 'active' };
    });
  }

  async loadCenterSnapshot(centerId: string, now: Date): Promise<VoiceCenterSnapshot | null> {
    return this.inCenter(centerId, async (client) => {
      const center = await client.center.findUnique({
        where: { id: centerId },
        select: {
          planId: true,
          timezone: true,
          disabledModules: true,
          closedAt: true,
          isVoiceReceptionistEnabled: true,
        },
      });
      if (center === null) return null;
      const [subscription, config] = await Promise.all([
        client.voiceReceptionistSubscription.findUnique({
          where: { centerId },
          select: { status: true, includedMinutes: true, periodStart: true, periodEnd: true },
        }),
        client.voiceAgentConfig.findUnique({ where: { centerId } }),
      ]);
      const usage =
        subscription === null
          ? null
          : await this.readUsage(client, { centerId, subscription, now });
      return {
        centerId,
        planId: center.planId,
        timeZone: center.timezone,
        disabledModules: center.disabledModules,
        isClosed: center.closedAt !== null,
        isVoiceReceptionistEnabled: center.isVoiceReceptionistEnabled,
        subscriptionStatus: subscription?.status ?? null,
        config: config === null ? null : toVoiceAgentConfigView(config),
        usage,
      };
    });
  }

  /** Los minutos usados en el periodo de cobro que contiene `now`. */
  private async readUsage(
    client: TenantTransactionClient,
    input: {
      centerId: string;
      subscription: { includedMinutes: number; periodStart: Date; periodEnd: Date };
      now: Date;
    },
  ): Promise<VoiceUsageSnapshot> {
    const { centerId, subscription, now } = input;
    const { periodStart } = resolveUsagePeriod(now, subscription);
    const row = await client.voiceUsagePeriod.findUnique({
      where: { centerId_periodStart: { centerId, periodStart } },
      select: { minutesUsed: true },
    });
    return { includedMinutes: subscription.includedMinutes, usedMinutes: row?.minutesUsed ?? 0 };
  }

  async readUsageAlertFacts(centerId: string): Promise<VoiceUsageAlertFacts | null> {
    return this.inCenter(centerId, async (client) => {
      const center = await client.center.findUnique({
        where: { id: centerId },
        select: { name: true, planId: true },
      });
      if (center === null) return null;
      const [config, addonPlan] = await Promise.all([
        client.voiceAgentConfig.findUnique({
          where: { centerId },
          select: { overagePolicy: true },
        }),
        client.voiceAddonPlan.findUnique({ where: { planId: center.planId } }),
      ]);
      return {
        centerName: center.name,
        overagePolicy: config?.overagePolicy ?? 'continue_and_charge',
        overageCentsPerMinute: addonPlan?.overageCentsPerMinute ?? null,
      };
    });
  }

  async openCallLog(
    centerId: string,
    call: { providerCallId: string; callerPhone: string; now: Date },
  ): Promise<{ callerMembershipId: string | null }> {
    return this.inCenter(centerId, async (client) => {
      const log = await client.voiceCallLog.upsert({
        where: { providerCallId: call.providerCallId },
        create: {
          id: generateUuidV7(),
          centerId,
          providerCallId: call.providerCallId,
          callerPhone: call.callerPhone,
          startedAt: call.now,
        },
        update: {},
        select: { callerMembershipId: true },
      });
      return { callerMembershipId: log.callerMembershipId };
    });
  }

  async bindCaller(centerId: string, providerCallId: string, membershipId: string): Promise<void> {
    await this.inCenter(centerId, (client) =>
      client.voiceCallLog.update({
        where: { providerCallId },
        data: { callerMembershipId: membershipId },
      }),
    );
  }

  async mergeCallOutcome(
    centerId: string,
    providerCallId: string,
    outcome: VoiceCallOutcomeName,
  ): Promise<void> {
    await this.inCenter(centerId, async (client) => {
      const log = await client.voiceCallLog.findUnique({
        where: { providerCallId },
        select: { outcome: true },
      });
      if (log === null) return;
      await client.voiceCallLog.update({
        where: { providerCallId },
        data: { outcome: mergeCallOutcomes(log.outcome, outcome) },
      });
    });
  }

  async countCenterCodeFailures(centerId: string, windowStart: Date): Promise<number> {
    return this.inCenter(centerId, async (client) => {
      const row = await client.voiceCodeFailureWindow.findUnique({
        where: { centerId_windowStart: { centerId, windowStart } },
        select: { failedCount: true },
      });
      return row?.failedCount ?? 0;
    });
  }

  async registerCenterCodeFailure(centerId: string, windowStart: Date): Promise<void> {
    await this.inCenter(centerId, (client) =>
      client.voiceCodeFailureWindow.upsert({
        where: {
          centerId_windowStart: { centerId, windowStart: resolveFailureWindowStart(windowStart) },
        },
        create: { centerId, windowStart: resolveFailureWindowStart(windowStart), failedCount: 1 },
        update: { failedCount: { increment: 1 } },
      }),
    );
  }

  async readCodeAttempts(centerId: string, callerPhone: string): Promise<CodeAttemptState> {
    return this.inCenter(centerId, async (client) => {
      const row = await client.voiceCodeAttempt.findUnique({
        where: { centerId_callerPhone: { centerId, callerPhone } },
      });
      return { failedCount: row?.failedCount ?? 0, lockedUntil: row?.lockedUntil ?? null };
    });
  }

  async writeCodeAttempts(
    centerId: string,
    callerPhone: string,
    state: CodeAttemptState,
  ): Promise<void> {
    await this.inCenter(centerId, (client) =>
      client.voiceCodeAttempt.upsert({
        where: { centerId_callerPhone: { centerId, callerPhone } },
        create: { centerId, callerPhone, ...state },
        update: { ...state },
      }),
    );
  }

  async findCallerByStudentCode(
    centerId: string,
    studentCode: string,
  ): Promise<VoiceCallerView | null> {
    return this.inCenter(centerId, async (client) => {
      const row = await client.membership.findFirst({
        where: { centerId, studentCode, role: 'client', status: 'active' },
        select: CALLER_SELECT,
      });
      return row === null ? null : toCallerView(row);
    });
  }

  async findCallerByMembershipId(
    centerId: string,
    membershipId: string,
  ): Promise<VoiceCallerView | null> {
    return this.inCenter(centerId, async (client) => {
      const row = await client.membership.findFirst({
        where: { id: membershipId, centerId, role: 'client', status: 'active' },
        select: CALLER_SELECT,
      });
      return row === null ? null : toCallerView(row);
    });
  }

  async findGuestByPhone(centerId: string, callerPhone: string): Promise<VoiceCallerView | null> {
    return this.inCenter(centerId, async (client) => {
      const row = await client.membership.findFirst({
        where: {
          centerId,
          role: 'client',
          status: 'active',
          joinSource: 'voice_guest',
          user: { phone: callerPhone },
        },
        select: CALLER_SELECT,
      });
      return row === null ? null : toCallerView(row);
    });
  }

  /**
   * Alta del invitado. `isStudent: false` lo deja fuera del tope de clientes del plan mientras sea invitado
   * (el tope solo cuenta alumnos). Sin contraseña utilizable y con un correo que no existe: nadie puede entrar
   * con esa cuenta.
   */
  async createGuest(
    centerId: string,
    guest: { fullName: string; phone: string },
  ): Promise<VoiceCallerView> {
    return this.inCenter(centerId, async (client) => {
      const userId = generateUuidV7();
      await client.user.create({
        data: {
          id: userId,
          email: `${userId}@${GUEST_EMAIL_DOMAIN}`,
          fullName: guest.fullName,
          phone: guest.phone,
          passwordHash: UNUSABLE_PASSWORD_HASH,
        },
      });
      const membership = await client.membership.create({
        data: {
          id: generateUuidV7(),
          centerId,
          userId,
          role: 'client',
          status: 'active',
          isStudent: false,
          joinSource: 'voice_guest',
        },
        select: CALLER_SELECT,
      });
      return toCallerView(membership);
    });
  }

  async listServices(centerId: string): Promise<readonly VoiceServiceView[]> {
    return this.inCenter(centerId, async (client) => {
      const rows = await client.service.findMany({
        where: { centerId, archivedAt: null, isVisible: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: SERVICE_SELECT,
      });
      return rows;
    });
  }

  async findService(centerId: string, serviceId: string): Promise<VoiceServiceView | null> {
    return this.inCenter(centerId, (client) =>
      client.service.findFirst({
        where: { id: serviceId, centerId, archivedAt: null, isVisible: true },
        select: SERVICE_SELECT,
      }),
    );
  }

  async countRemainingPassSessions(
    centerId: string,
    membershipId: string,
    now: Date,
  ): Promise<number> {
    return this.inCenter(centerId, async (client) => {
      const passes = await client.clientPass.findMany({
        where: { clientMembershipId: membershipId, status: 'active', remainingSessions: { gt: 0 } },
        select: { remainingSessions: true, expiresAt: true },
      });
      return passes
        .filter((pass) => pass.expiresAt === null || pass.expiresAt > now)
        .reduce((total, pass) => total + pass.remainingSessions, 0);
    });
  }

  async findToolReply(
    centerId: string,
    call: { providerCallId: string; toolCallId: string },
  ): Promise<VoiceToolReply | null> {
    return this.inCenter(centerId, async (client) => {
      const row = await client.voiceToolCall.findUnique({
        where: { providerCallId_toolCallId: call },
        select: { result: true },
      });
      return row === null ? null : (row.result as unknown as VoiceToolReply);
    });
  }

  async saveToolReply(
    centerId: string,
    call: { providerCallId: string; toolCallId: string },
    reply: VoiceToolReply,
  ): Promise<void> {
    await this.inCenter(centerId, (client) =>
      client.voiceToolCall.upsert({
        where: { providerCallId_toolCallId: call },
        create: { ...call, centerId, result: JSON.parse(JSON.stringify(reply)) as object },
        update: {},
      }),
    );
  }

  async finishCall(
    centerId: string,
    end: VoiceCallEnd,
    billedMinutes: number,
  ): Promise<VoiceCallFinishOutcome> {
    return this.inCenter(centerId, async (client) => {
      const previous = await client.voiceCallLog.findUnique({
        where: { providerCallId: end.providerCallId },
        select: { endedAt: true },
      });
      // Si el proveedor repite el informe de fin de llamada, los minutos no se suman ni se avisa dos veces.
      const isFirstReport = previous?.endedAt == null;
      const callLogId = await this.writeEndedCall(client, centerId, end);
      if (!isFirstReport || billedMinutes <= 0) {
        return { callLogId, overageMinutes: 0, alertsToSend: [], usage: null };
      }
      return this.countCallMinutes(client, { centerId, callLogId, end, billedMinutes });
    });
  }

  /** Suma los minutos al periodo y deja apuntado cuánto fue exceso y qué avisos toca enviar. */
  private async countCallMinutes(
    client: TenantTransactionClient,
    input: { centerId: string; callLogId: string; end: VoiceCallEnd; billedMinutes: number },
  ): Promise<VoiceCallFinishOutcome> {
    const { centerId, callLogId, end, billedMinutes } = input;
    const usage = await this.addUsage(client, { centerId, endedAt: end.endedAt, billedMinutes });
    if (usage === null) {
      await client.voiceCallLog.update({ where: { id: callLogId }, data: { billedMinutes } });
      return { callLogId, overageMinutes: 0, alertsToSend: [], usage: null };
    }
    const overageMinutes = calculateCallOverageMinutes({
      includedMinutes: usage.includedMinutes,
      usedBefore: usage.usedBefore,
      billedMinutes,
    });
    await client.voiceCallLog.update({
      where: { id: callLogId },
      data: { billedMinutes, overageMinutes },
    });
    const crossed = findCrossedUsageThresholds({
      includedMinutes: usage.includedMinutes,
      usedBefore: usage.usedBefore,
      usedAfter: usage.usedBefore + billedMinutes,
    });
    return {
      callLogId,
      overageMinutes,
      alertsToSend: await this.claimAlerts(client, {
        centerId,
        periodStart: usage.periodStart,
        crossed,
        claimedAt: end.endedAt,
      }),
      usage: {
        includedMinutes: usage.includedMinutes,
        usedMinutes: usage.usedBefore + billedMinutes,
      },
    };
  }

  /**
   * Apunta cada aviso antes de enviarlo: solo quien consigue el apunte lo envía, así dos llamadas que cruzan el
   * mismo umbral a la vez no avisan dos veces.
   */
  private async claimAlerts(
    client: TenantTransactionClient,
    input: {
      centerId: string;
      periodStart: Date;
      crossed: readonly UsageAlertPercent[];
      claimedAt: Date;
    },
  ): Promise<UsageAlertPercent[]> {
    const claimed: UsageAlertPercent[] = [];
    for (const percent of input.crossed) {
      const column = percent === WARNING_PERCENT ? 'alerted80At' : 'alerted100At';
      const result = await client.voiceUsagePeriod.updateMany({
        where: { centerId: input.centerId, periodStart: input.periodStart, [column]: null },
        data: { [column]: input.claimedAt },
      });
      if (result.count === 1) claimed.push(percent);
    }
    return claimed;
  }

  private async writeEndedCall(
    client: TenantTransactionClient,
    centerId: string,
    end: VoiceCallEnd,
  ): Promise<string> {
    const details = {
      endedAt: end.endedAt,
      durationSeconds: end.durationSeconds,
      summary: end.summary,
      transcript: end.transcript,
      estimatedCostCents: end.estimatedCostCents,
    };
    const log = await client.voiceCallLog.upsert({
      where: { providerCallId: end.providerCallId },
      create: {
        id: generateUuidV7(),
        centerId,
        providerCallId: end.providerCallId,
        callerPhone: end.callerNumber,
        startedAt: end.startedAt,
        outcome: 'no_action',
        ...details,
      },
      update: details,
      select: { id: true },
    });
    // Una llamada que no hizo nada concreto queda como «sin acción» en lugar de sin resultado.
    await client.voiceCallLog.updateMany({
      where: { providerCallId: end.providerCallId, outcome: null },
      data: { outcome: 'no_action' },
    });
    return log.id;
  }

  /** `null` si el centro no tiene suscripción al add-on: sus minutos no se miden contra nada. */
  private async addUsage(
    client: TenantTransactionClient,
    usage: { centerId: string; endedAt: Date; billedMinutes: number },
  ): Promise<{
    periodStart: Date;
    usedBefore: number;
    includedMinutes: number;
  } | null> {
    const { centerId, endedAt, billedMinutes } = usage;
    const subscription = await client.voiceReceptionistSubscription.findUnique({
      where: { centerId },
      select: { periodStart: true, periodEnd: true, includedMinutes: true },
    });
    const { periodStart } = resolveUsagePeriod(endedAt, subscription);
    const row = await client.voiceUsagePeriod.upsert({
      where: { centerId_periodStart: { centerId, periodStart } },
      create: { centerId, periodStart, minutesUsed: billedMinutes },
      update: { minutesUsed: { increment: billedMinutes } },
      select: { minutesUsed: true },
    });
    if (subscription === null) return null;
    return {
      periodStart,
      usedBefore: row.minutesUsed - billedMinutes,
      includedMinutes: subscription.includedMinutes,
    };
  }

  private inCenter<TResult>(
    centerId: string,
    work: (client: TenantTransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.tenantPrismaService.runInTenantContext(buildVoiceSystemActor(centerId), work);
  }
}

const SERVICE_SELECT = {
  id: true,
  name: true,
  mode: true,
  durationMinutes: true,
  allowsTrialBookings: true,
  isRental: true,
} as const;
