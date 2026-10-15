import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { toDateColumn } from './schedule-materialization';

export type ScheduleOverlapKind = 'room_schedule_overlap' | 'teacher_schedule_overlap';

export interface ScheduleCandidate {
  readonly roomId: string | null;
  /** `null` en los alquileres: no hay profesor que pueda estar en dos sitios. */
  readonly staffMembershipId: string | null;
  /** 1 = lunes … 7 = domingo. */
  readonly weekdays: readonly number[];
  /** `HH:MM`. */
  readonly startsAtTime: string;
  readonly endsAtTime: string;
  readonly startsOn: string;
  /** `null` = sin fin. */
  readonly endsOn: string | null;
  /** La serie que se está editando: no choca consigo misma. */
  readonly excludeSeriesId?: string | undefined;
}

/**
 * Los horarios activos que coinciden con el candidato: algún mismo día de la semana, las horas se
 * pisan (14:00–16:00 contra 15:00–17:00, pero no contra 16:00–18:00) y los periodos se cruzan.
 */
function buildOverlapFilter(candidate: ScheduleCandidate) {
  return {
    status: 'active' as const,
    weekday: { in: [...candidate.weekdays] },
    startsAtTime: { lt: candidate.endsAtTime },
    endsAtTime: { gt: candidate.startsAtTime },
    ...(candidate.endsOn === null ? {} : { startsOn: { lte: toDateColumn(candidate.endsOn) } }),
    OR: [{ endsOn: null }, { endsOn: { gte: toDateColumn(candidate.startsOn) } }],
    ...(candidate.excludeSeriesId === undefined
      ? {}
      : { NOT: { seriesId: candidate.excludeSeriesId } }),
  };
}

/**
 * Si un horario nuevo (o editado) pisaría a otro en la misma sala, o dejaría a la misma persona en
 * dos sitios a la vez. Mismo día y otra hora, u otra semana, no choca.
 */
export async function findScheduleOverlap(
  client: TenantTransactionClient,
  candidate: ScheduleCandidate,
): Promise<ScheduleOverlapKind | null> {
  const filter = buildOverlapFilter(candidate);
  if (candidate.roomId !== null) {
    const roomCount = await client.sessionSchedule.count({
      where: { ...filter, roomId: candidate.roomId },
    });
    if (roomCount > 0) return 'room_schedule_overlap';
  }
  if (candidate.staffMembershipId === null) return null;
  const teacherCount = await client.sessionSchedule.count({
    where: { ...filter, staffMembershipId: candidate.staffMembershipId },
  });
  return teacherCount > 0 ? 'teacher_schedule_overlap' : null;
}
