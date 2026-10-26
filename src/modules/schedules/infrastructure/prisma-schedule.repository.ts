import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type CancelSessionOutcome,
  type EndSeriesOutcome,
  type EnrollmentView,
  type EnrollOutcome,
  type MoveSessionOutcome,
  type NewEnrollments,
  type NewScheduleSeries,
  type BusyTimeView,
  type ScheduleRepository,
  type ScheduleSeriesCreationOutcome,
  type ScheduleSeriesPatch,
  type ScheduleSeriesUpdateOutcome,
  type ScheduleSeriesView,
  type SessionCancellation,
  type SessionMove,
  type UnenrollOutcome,
} from '../application/ports/schedule.repository';
import { enrollInTransaction, unenrollInTransaction } from './enrollment-writes';
import { findBusyTimes } from './busy-times';
import { materializeSchedulesInTransaction, resolveLocalToday } from './schedule-materialization';
import {
  ENROLLMENT_VIEW_INCLUDE,
  listSeriesViews,
  SCHEDULE_VIEW_INCLUDE,
  toEnrollmentView,
} from './schedule-view.mapper';
import {
  createSeriesInTransaction,
  endSeriesInTransaction,
  updateSeriesInTransaction,
} from './series-writes';
import { cancelSessionWithBookings, findCancellableSession } from './session-cancellation';
import { moveSessionInTransaction } from './session-move';

@Injectable()
export class PrismaScheduleRepository implements ScheduleRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listBusyTimes(
    actor: ActorContext,
    query: { roomId: string | null; staffMembershipId: string | null; now: Date },
  ): Promise<BusyTimeView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) =>
      findBusyTimes(client, { ...query, today: await resolveLocalToday(client, query.now) }),
    );
  }

  async listSeries(actor: ActorContext, query: { now: Date }): Promise<ScheduleSeriesView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const today = await resolveLocalToday(client, query.now);
      await materializeSchedulesInTransaction(client, { today });
      const rows = await client.sessionSchedule.findMany({
        include: SCHEDULE_VIEW_INCLUDE,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }, { weekday: 'asc' }],
      });
      return listSeriesViews(client, rows);
    });
  }

  async createSeries(
    actor: ActorContext,
    newSeries: NewScheduleSeries,
    now: Date,
  ): Promise<ScheduleSeriesCreationOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) =>
      createSeriesInTransaction(client, actor, {
        newSeries,
        today: await resolveLocalToday(client, now),
      }),
    );
  }

  async updateSeries(
    actor: ActorContext,
    request: { seriesId: string; patch: ScheduleSeriesPatch; now: Date },
  ): Promise<ScheduleSeriesUpdateOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) =>
      updateSeriesInTransaction(client, actor, {
        ...request,
        today: await resolveLocalToday(client, request.now),
      }),
    );
  }

  async endSeries(
    actor: ActorContext,
    request: { seriesId: string; now: Date },
  ): Promise<EndSeriesOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      endSeriesInTransaction(client, actor, request),
    );
  }

  async listEnrollments(actor: ActorContext, seriesId: string): Promise<EnrollmentView[] | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const hasSeries = (await client.sessionSchedule.count({ where: { seriesId } })) > 0;
      if (!hasSeries) return null;
      const enrollments = await client.scheduleEnrollment.findMany({
        where: { seriesId, status: 'active' },
        include: ENROLLMENT_VIEW_INCLUDE,
        orderBy: [{ clientMembership: { user: { fullName: 'asc' } } }, { id: 'asc' }],
      });
      return enrollments.map(toEnrollmentView);
    });
  }

  async enroll(
    actor: ActorContext,
    request: NewEnrollments & { now: Date },
  ): Promise<EnrollOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      enrollInTransaction(client, actor, request),
    );
  }

  async unenroll(
    actor: ActorContext,
    request: { seriesId: string; enrollmentId: string; now: Date },
  ): Promise<UnenrollOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      unenrollInTransaction(client, actor, request),
    );
  }

  async cancelSession(
    actor: ActorContext,
    cancellation: SessionCancellation,
  ): Promise<CancelSessionOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const session = await findCancellableSession(client, cancellation.sessionId);
      if (!session) return { kind: 'not_found' };
      if (session.startsAt <= cancellation.now) return { kind: 'not_cancellable' };
      const affectedBookingCount = await cancelSessionWithBookings(client, actor, {
        session,
        reason: cancellation.reason,
        now: cancellation.now,
        shouldNotify: true,
      });
      return { kind: 'cancelled', affectedBookingCount };
    });
  }

  async moveSession(actor: ActorContext, move: SessionMove): Promise<MoveSessionOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      moveSessionInTransaction(client, actor, move),
    );
  }
}
