import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NewTimeEntry,
  type TeamClockScanOutcome,
  type TimeEntryChangeOutcome,
  type TimeEntryPatch,
  type TimeEntryRepository,
  type TimeEntryView,
} from '../application/ports/time-entry.repository';
import {
  decideClockAction,
  deriveWorkDate,
  doTimeRangesOverlap,
  findTimeEntryViolation,
  getMonthDateRange,
  type TimeRange,
} from '../domain/time-entry-rules';
import { toTimeEntryView, toWorkDateColumn, type StoredTimeEntry } from './time-entry-view.mapper';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

/** Serializa los cambios de una misma persona: dos escaneos o ediciones a la vez no se cruzan. */
async function lockTimeline(client: TenantTransactionClient, staffMembershipId: string) {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtext(${staffMembershipId}))`;
}

async function readCenterTimeZone(client: TenantTransactionClient): Promise<string> {
  const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
  return center.timezone;
}

async function hasOverlap(
  client: TenantTransactionClient,
  query: { staffMembershipId: string; range: TimeRange; excludedEntryId?: string },
): Promise<boolean> {
  const { range } = query;
  const neighbours = await client.staffTimeEntry.findMany({
    where: {
      staffMembershipId: query.staffMembershipId,
      deletedAt: null,
      ...(query.excludedEntryId && { id: { not: query.excludedEntryId } }),
      ...(range.clockOutAt && { clockInAt: { lt: range.clockOutAt } }),
      OR: [{ clockOutAt: null }, { clockOutAt: { gt: range.clockInAt } }],
    },
    select: { clockInAt: true, clockOutAt: true },
  });
  return neighbours.some((neighbour) => doTimeRangesOverlap(neighbour, range));
}

/** Una escritura entre personas del equipo: el personal solo toca lo suyo; administración, todo el centro. */
function visibleEntryFilter(actor: ActorContext): { staffMembershipId?: string } {
  return actor.role === 'staff' ? { staffMembershipId: actor.membershipId } : {};
}

interface ScanContext {
  readonly staffMembershipId: string;
  readonly fullName: string;
  readonly actor: ActorContext;
  readonly now: Date;
}

function buildRecordedScan(
  context: ScanContext,
  result: { action: 'clock_in' | 'clock_out'; entry: StoredTimeEntry },
): TeamClockScanOutcome {
  const entry = toTimeEntryView(result.entry);
  const isClockOut = result.action === 'clock_out';
  return {
    kind: 'recorded',
    scan: {
      staffMembershipId: context.staffMembershipId,
      fullName: context.fullName,
      action: result.action,
      occurredAt: (isClockOut ? entry.clockOutAt : entry.clockInAt) ?? context.now,
      workedMinutes: isClockOut ? entry.workedMinutes : null,
      entry,
    },
  };
}

async function openNewShift(
  client: TenantTransactionClient,
  context: ScanContext,
): Promise<StoredTimeEntry> {
  const timeZone = await readCenterTimeZone(client);
  return client.staffTimeEntry.create({
    data: {
      id: generateUuidV7(),
      centerId: context.actor.centerId,
      staffMembershipId: context.staffMembershipId,
      workDate: toWorkDateColumn(deriveWorkDate(context.now, timeZone)),
      clockInAt: context.now,
      inSource: 'qr',
      scannedByMembershipId: context.actor.membershipId,
    },
  });
}

/** Alterna entrada y salida de la persona según su turno más reciente. */
async function clockTeamMember(
  client: TenantTransactionClient,
  context: ScanContext,
): Promise<TeamClockScanOutcome> {
  const { staffMembershipId, actor, now } = context;
  const lastShift = await client.staffTimeEntry.findFirst({
    where: { staffMembershipId, deletedAt: null },
    orderBy: { clockInAt: 'desc' },
  });
  const decision = decideClockAction({ lastShift, now });

  if (decision.kind === 'repeat' && lastShift) {
    return buildRecordedScan(context, { action: decision.action, entry: lastShift });
  }
  if (decision.kind === 'clock_out') {
    const closed = await client.staffTimeEntry.update({
      where: { id: decision.entryId },
      data: { clockOutAt: now, outSource: 'qr', scannedByMembershipId: actor.membershipId },
    });
    return buildRecordedScan(context, { action: 'clock_out', entry: closed });
  }
  if (decision.kind === 'clock_in_after_abandoned') {
    // La salida olvidada no se puede adivinar: el turno se descarta y la persona lo repone a mano.
    await client.staffTimeEntry.update({
      where: { id: decision.abandonedEntryId },
      data: { deletedAt: now },
    });
  }
  return buildRecordedScan(context, {
    action: 'clock_in',
    entry: await openNewShift(client, context),
  });
}

@Injectable()
export class PrismaTimeEntryRepository implements TimeEntryRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async recordTeamScan(
    actor: ActorContext,
    command: { scannedMembershipId: string; now: Date },
  ): Promise<TeamClockScanOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const member = await client.membership.findFirst({
        where: {
          id: command.scannedMembershipId,
          status: 'active',
          role: { in: [...TEAM_ROLES] },
        },
        select: { user: { select: { fullName: true } } },
      });
      if (!member) return { kind: 'not_team_member' };
      await lockTimeline(client, command.scannedMembershipId);
      return clockTeamMember(client, {
        staffMembershipId: command.scannedMembershipId,
        fullName: member.user.fullName,
        actor,
        now: command.now,
      });
    });
  }

  async listForMonth(
    actor: ActorContext,
    query: { staffMembershipId: string; month: string },
  ): Promise<readonly TimeEntryView[]> {
    const { fromDate, toDate } = getMonthDateRange(query.month);
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const stored = await client.staffTimeEntry.findMany({
        where: {
          staffMembershipId: query.staffMembershipId,
          deletedAt: null,
          workDate: { gte: toWorkDateColumn(fromDate), lte: toWorkDateColumn(toDate) },
        },
        orderBy: { clockInAt: 'asc' },
      });
      return stored.map(toTimeEntryView);
    });
  }

  async create(actor: ActorContext, newEntry: NewTimeEntry): Promise<TimeEntryChangeOutcome> {
    const range = { clockInAt: newEntry.clockInAt, clockOutAt: newEntry.clockOutAt };
    const violation = findTimeEntryViolation({ ...range, now: newEntry.now });
    if (violation) return { kind: 'violation', violation };
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await lockTimeline(client, newEntry.staffMembershipId);
      if (await hasOverlap(client, { staffMembershipId: newEntry.staffMembershipId, range })) {
        return { kind: 'overlap' };
      }
      const timeZone = await readCenterTimeZone(client);
      const created = await client.staffTimeEntry.create({
        data: {
          id: generateUuidV7(),
          centerId: actor.centerId,
          staffMembershipId: newEntry.staffMembershipId,
          workDate: toWorkDateColumn(deriveWorkDate(newEntry.clockInAt, timeZone)),
          ...range,
          inSource: 'manual',
          outSource: 'manual',
          isEdited: true,
          editedAt: newEntry.now,
          editedByMembershipId: actor.membershipId,
        },
      });
      return { kind: 'saved', entry: toTimeEntryView(created) };
    });
  }

  async update(actor: ActorContext, patch: TimeEntryPatch): Promise<TimeEntryChangeOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const stored = await client.staffTimeEntry.findFirst({
        where: { id: patch.entryId, deletedAt: null, ...visibleEntryFilter(actor) },
      });
      if (!stored) return { kind: 'not_found' };
      await lockTimeline(client, stored.staffMembershipId);

      const range = {
        clockInAt: patch.clockInAt ?? stored.clockInAt,
        clockOutAt: patch.clockOutAt ?? stored.clockOutAt,
      };
      const violation = findTimeEntryViolation({ ...range, now: patch.now });
      if (violation) return { kind: 'violation', violation };
      const overlapQuery = {
        staffMembershipId: stored.staffMembershipId,
        range,
        excludedEntryId: stored.id,
      };
      if (await hasOverlap(client, overlapQuery)) return { kind: 'overlap' };

      const timeZone = await readCenterTimeZone(client);
      const updated = await client.staffTimeEntry.update({
        where: { id: stored.id },
        data: {
          ...range,
          workDate: toWorkDateColumn(deriveWorkDate(range.clockInAt, timeZone)),
          ...(patch.clockInAt && { inSource: 'manual' }),
          ...(patch.clockOutAt && { outSource: 'manual' }),
          // Las horas originales se guardan solo la primera vez que se edita.
          ...(!stored.isEdited && {
            originalClockInAt: stored.clockInAt,
            originalClockOutAt: stored.clockOutAt,
          }),
          isEdited: true,
          editedAt: patch.now,
          editedByMembershipId: actor.membershipId,
        },
      });
      return { kind: 'saved', entry: toTimeEntryView(updated) };
    });
  }

  async softDelete(actor: ActorContext, command: { entryId: string; now: Date }): Promise<boolean> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const deleted = await client.staffTimeEntry.updateMany({
        where: { id: command.entryId, deletedAt: null, ...visibleEntryFilter(actor) },
        data: { deletedAt: command.now },
      });
      return deleted.count === 1;
    });
  }
}
