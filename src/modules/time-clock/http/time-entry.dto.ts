import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class TimeEntryRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), entryId: z.uuid() }),
) {}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class TimeEntryListQueryDto extends createZodDto(
  z.strictObject({
    /** Mes de la fecha de trabajo (zona del centro), `YYYY-MM`. */
    month: z.string().regex(MONTH_PATTERN),
    /** Solo owner/admin: ver el registro de otra persona del equipo. */
    staffMembershipId: z.uuid().optional(),
  }),
) {}

const timeEntrySource = z.enum(['qr', 'manual']);

/** Un turno de trabajo (fichaje). */
export const timeEntryShape = {
  id: z.uuid(),
  staffMembershipId: z.uuid(),
  /** Fecha local del centro, `YYYY-MM-DD`, en la que empieza el turno. */
  workDate: z.string(),
  clockInAt: z.iso.datetime(),
  clockOutAt: z.iso.datetime().nullable(),
  /** Sin salida todavía: cuenta 0 minutos hasta que se cierre. */
  isOpen: z.boolean(),
  workedMinutes: z.number().int(),
  inSource: timeEntrySource,
  outSource: timeEntrySource.nullable(),
  /** Corregido a mano después de registrarse (o dado de alta a mano). */
  isEdited: z.boolean(),
  /** Horas antes de la primera corrección; nulas si no se corrigió o es un alta manual. */
  originalClockInAt: z.iso.datetime().nullable(),
  originalClockOutAt: z.iso.datetime().nullable(),
  editedAt: z.iso.datetime().nullable(),
};

export const timeEntrySchema = z.strictObject(timeEntryShape);

export class TimeEntryResponseDto extends createZodDto(timeEntrySchema) {}

export class TimeEntryListResponseDto extends createZodDto(
  z.strictObject({
    month: z.string(),
    staffMembershipId: z.uuid(),
    entries: z.array(timeEntrySchema),
    totals: z.strictObject({
      workedMinutes: z.number().int(),
      daysWorked: z.number().int(),
      editedCount: z.number().int(),
    }),
  }),
) {}

export class CreateTimeEntryRequestDto extends createZodDto(
  z.strictObject({ clockInAt: z.iso.datetime(), clockOutAt: z.iso.datetime() }),
) {}

export class UpdateTimeEntryRequestDto extends createZodDto(
  z
    .strictObject({
      clockInAt: z.iso.datetime().optional(),
      clockOutAt: z.iso.datetime().optional(),
    })
    .refine((body) => body.clockInAt !== undefined || body.clockOutAt !== undefined),
) {}
