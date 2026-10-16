import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { daysBetweenLocalDates } from '../../../shared/time/zoned-time';
import { isValidTimeOfDay } from '../../centers/domain/opening-hours';
import {
  isTimeRangeOrdered,
  MAX_CANCEL_REASON_LENGTH,
  MAX_DAYS_PER_SERIES,
  MAX_ENROLLMENTS_PER_REQUEST,
  MAX_SCHEDULE_CAPACITY,
  MAX_SCHEDULE_LABEL_LENGTH,
  MAX_SERIES_LENGTH_DAYS,
  MIN_SCHEDULE_CAPACITY,
} from '../domain/schedule-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}
export class SeriesRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), seriesId: z.uuid() }),
) {}
export class EnrollmentRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), seriesId: z.uuid(), enrollmentId: z.uuid() }),
) {}
export class SessionRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), sessionId: z.uuid() }),
) {}
export class RoomRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), roomId: z.uuid() }),
) {}
export class BlockRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), roomId: z.uuid(), blockId: z.uuid() }),
) {}

const timeSchema = z.string().refine(isValidTimeOfDay, 'HH:MM');
const weekdaySchema = z.number().int().min(1).max(MAX_DAYS_PER_SERIES);
const capacitySchema = z.number().int().min(MIN_SCHEDULE_CAPACITY).max(MAX_SCHEDULE_CAPACITY);
const labelSchema = z.string().trim().min(1).max(MAX_SCHEDULE_LABEL_LENGTH);

const personShape = z.strictObject({ membershipId: z.uuid(), fullName: z.string() });

const seriesShape = {
  seriesId: z.uuid(),
  label: z.string().nullable(),
  mode: z.enum(['private', 'group']),
  /** Personas por sesión. */
  capacity: z.number().int(),
  status: z.enum(['active', 'ended']),
  startsOn: z.iso.date(),
  endsOn: z.iso.date().nullable(),
  service: z.strictObject({ id: z.uuid(), name: z.string(), color: z.string().nullable() }),
  staff: personShape.nullable(),
  room: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  /** Un elemento por día de la semana (1 = lunes … 7 = domingo). */
  days: z.array(
    z.strictObject({
      scheduleId: z.uuid(),
      weekday: weekdaySchema,
      startsAtTime: z.string(),
      endsAtTime: z.string(),
    }),
  ),
  enrolledCount: z.number().int(),
};

const skippedOccurrenceShape = z.strictObject({
  date: z.iso.date(),
  startsAtTime: z.string(),
  /** Festivo del centro, ausencia de la persona, sala o persona ya ocupadas, o sala bloqueada. */
  reason: z.enum(['holiday', 'absence', 'conflict']),
});

export class ScheduleSeriesListResponseDto extends createZodDto(
  z.strictObject({ series: z.array(z.strictObject(seriesShape)) }),
) {}

export class ScheduleSeriesWriteResponseDto extends createZodDto(
  z.strictObject({
    series: z.strictObject(seriesShape),
    /** Fechas de las próximas 8 semanas en las que no se pudo crear la sesión. */
    skipped: z.array(skippedOccurrenceShape),
  }),
) {}

function isPeriodValid(period: { startsOn: string; endsOn?: string | null | undefined }): boolean {
  if (period.endsOn === undefined || period.endsOn === null) return true;
  const lengthDays = daysBetweenLocalDates(period.startsOn, period.endsOn);
  return lengthDays >= 0 && lengthDays <= MAX_SERIES_LENGTH_DAYS;
}

export class CreateScheduleSeriesRequestDto extends createZodDto(
  z
    .strictObject({
      serviceId: z.uuid(),
      /** Sin ella se usa el profesor fijo de la sala. */
      staffMembershipId: z.uuid().optional(),
      /** Sin ella, la sala fija del servicio si la tiene; si no, sin sala. */
      roomId: z.uuid().optional(),
      mode: z.enum(['private', 'group']).default('group'),
      /** Tope de personas por sesión; sin él, el aforo de la sala. */
      capacity: capacitySchema.optional(),
      weekdays: z
        .array(weekdaySchema)
        .min(1)
        .max(MAX_DAYS_PER_SERIES)
        .refine((days) => new Set(days).size === days.length, 'duplicated'),
      startsAtTime: timeSchema,
      endsAtTime: timeSchema,
      startsOn: z.iso.date(),
      endsOn: z.iso.date().nullable().default(null),
      label: labelSchema.optional(),
    })
    .refine(
      (body) => isTimeRangeOrdered(body.startsAtTime, body.endsAtTime),
      'ends before it starts',
    )
    .refine(isPeriodValid, 'ends before it starts or lasts over 400 days'),
) {}

export class UpdateScheduleSeriesRequestDto extends createZodDto(
  z
    .strictObject({
      label: labelSchema.nullable().optional(),
      capacity: capacitySchema.optional(),
      endsOn: z.iso.date().nullable().optional(),
      staffMembershipId: z.uuid().optional(),
      /** `null` deja la serie sin sala. */
      roomId: z.uuid().nullable().optional(),
      startsAtTime: timeSchema.optional(),
      endsAtTime: timeSchema.optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, 'send at least one field to change')
    .refine(
      (patch) =>
        patch.startsAtTime === undefined ||
        patch.endsAtTime === undefined ||
        isTimeRangeOrdered(patch.startsAtTime, patch.endsAtTime),
      'ends before it starts',
    ),
) {}

export class EndSeriesResponseDto extends createZodDto(
  z.strictObject({
    /** Sesiones futuras que siguen porque tienen citas sueltas. */
    keptSessionCount: z.number().int(),
  }),
) {}

const enrollmentShape = {
  id: z.uuid(),
  client: personShape,
  startsOn: z.iso.date(),
  endsOn: z.iso.date().nullable(),
  status: z.enum(['active', 'ended']),
  createdAt: z.iso.datetime(),
};

export class EnrollmentListResponseDto extends createZodDto(
  z.strictObject({ enrollments: z.array(z.strictObject(enrollmentShape)) }),
) {}

export class EnrollRequestDto extends createZodDto(
  z
    .strictObject({
      clientMembershipIds: z.array(z.uuid()).min(1).max(MAX_ENROLLMENTS_PER_REQUEST),
      /** Sin ellas, las de la serie. */
      startsOn: z.iso.date().optional(),
      endsOn: z.iso.date().nullable().optional(),
    })
    .refine(
      (body) =>
        body.startsOn === undefined ||
        body.endsOn === undefined ||
        body.endsOn === null ||
        body.endsOn >= body.startsOn,
      'ends before it starts',
    ),
) {}

export class EnrollResponseDto extends createZodDto(
  z.strictObject({
    enrollments: z.array(z.strictObject(enrollmentShape)),
    /** Personas que no se pudieron matricular y por qué. */
    skipped: z.array(
      z.strictObject({
        clientMembershipId: z.uuid(),
        reason: z.enum(['client_not_found', 'already_enrolled', 'series_full', 'no_active_pass']),
      }),
    ),
    /** Días en los que una persona matriculada no entra porque ya tenía otra cita. */
    skippedDates: z.array(z.strictObject({ clientMembershipId: z.uuid(), date: z.iso.date() })),
  }),
) {}

export class UnenrollResponseDto extends createZodDto(
  z.strictObject({ cancelledBookingCount: z.number().int() }),
) {}

export class CancelSessionRequestDto extends createZodDto(
  z.strictObject({ reason: z.string().trim().min(1).max(MAX_CANCEL_REASON_LENGTH) }),
) {}

export class CancelSessionResponseDto extends createZodDto(
  z.strictObject({ affectedBookingCount: z.number().int() }),
) {}

export class BusyTimesQueryDto extends createZodDto(
  z
    .strictObject({
      roomId: z.uuid().optional(),
      staffMembershipId: z.uuid().optional(),
    })
    .refine(
      ({ roomId, staffMembershipId }) => roomId !== undefined || staffMembershipId !== undefined,
      'send a room or a teacher',
    ),
) {}

export class BusyTimesResponseDto extends createZodDto(
  z.strictObject({
    busy: z.array(
      z.strictObject({
        /** 1 = lunes … 7 = domingo. */
        weekday: z.number().int(),
        startsAtTime: z.string(),
        endsAtTime: z.string(),
        source: z.enum(['room', 'teacher']),
        className: z.string(),
        startsOn: z.string(),
        endsOn: z.string().nullable(),
      }),
    ),
  }),
) {}
