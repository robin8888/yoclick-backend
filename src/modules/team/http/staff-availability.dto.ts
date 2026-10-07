import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { fullWeekHoursSchema, openingHoursSchema } from '../../centers/http/opening-hours.schema';

const ABSENCE_REASONS = ['vacation', 'training', 'personal', 'other'] as const;
/** Una ausencia más larga que esto es un descuido, no unas vacaciones. */
const MAX_ABSENCE_DAYS = 366;
const MILLISECONDS_PER_DAY = 86_400_000;

export class AvailabilityRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid() }),
) {}

export class AbsenceRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid(), absenceId: z.uuid() }),
) {}

const absenceShape = {
  id: z.uuid(),
  /** Primer día, `YYYY-MM-DD` (fecha local del centro). */
  startsOn: z.iso.date(),
  /** Último día, incluido. */
  endsOn: z.iso.date(),
  reason: z.enum(ABSENCE_REASONS),
};

export class StaffAvailabilityResponseDto extends createZodDto(
  z.strictObject({
    /** Horario propio; `null` si sigue el del centro. Un día sin tramos no trabaja. */
    weeklyHours: fullWeekHoursSchema.nullable(),
    absences: z.array(z.strictObject(absenceShape)),
  }),
) {}

export class SaveStaffWeeklyHoursRequestDto extends createZodDto(
  z.strictObject({ weeklyHours: openingHoursSchema.nullable() }),
) {}

export class AddStaffAbsenceRequestDto extends createZodDto(
  z
    .strictObject({
      startsOn: z.iso.date(),
      endsOn: z.iso.date(),
      reason: z.enum(ABSENCE_REASONS),
    })
    .refine(({ startsOn, endsOn }) => startsOn <= endsOn, 'the end cannot be before the start')
    .refine(
      ({ startsOn, endsOn }) =>
        (Date.parse(endsOn) - Date.parse(startsOn)) / MILLISECONDS_PER_DAY < MAX_ABSENCE_DAYS,
      'the absence is too long',
    ),
) {}

export class AddedStaffAbsenceResponseDto extends createZodDto(
  z.strictObject({
    ...absenceShape,
    /** Citas que ya había en esas fechas: el centro decide si las reasigna o avisa. */
    affectedBookingCount: z.number().int(),
  }),
) {}
