import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { timeEntrySchema } from '../../time-clock/http/time-entry.dto';
import { bookingShape } from './booking.dto';

const MAX_QR_CONTENT_LENGTH = 2000;

export class CheckInCodeResponseDto extends createZodDto(
  z.strictObject({
    /** Lo que debe codificar el QR (`yoclick:checkin:<jwt>`). La app no lo interpreta ni lo firma. */
    qrContent: z.string(),
    /** Pasada esta hora el código ya no vale: la app lo renueva antes. */
    expiresAt: z.iso.datetime(),
  }),
) {}

export class CheckInRequestDto extends createZodDto(
  z.strictObject({ qrContent: z.string().min(1).max(MAX_QR_CONTENT_LENGTH) }),
) {}

/** Lo que registra un escaneo del equipo: su entrada o su salida. */
const staffClockSchema = z.strictObject({
  membershipId: z.uuid(),
  fullName: z.string(),
  action: z.enum(['clock_in', 'clock_out']),
  occurredAt: z.iso.datetime(),
  /** Solo en la salida: minutos del turno que se cierra. */
  workedMinutes: z.number().int().nullable(),
  entry: timeEntrySchema,
});

/**
 * `kind: 'client'` trae la llegada a la cita; `kind: 'staff'` trae el fichaje de la persona del equipo
 * (entonces `clientFullName`, `checkedInAt`, `isFirstCheckIn` y `booking` no vienen).
 */
export class CheckInResponseDto extends createZodDto(
  z.strictObject({
    kind: z.enum(['client', 'staff']),
    clientFullName: z.string().optional(),
    checkedInAt: z.iso.datetime().optional(),
    /** `false` si esa llegada ya estaba registrada (repetir el escaneo no falla). */
    isFirstCheckIn: z.boolean().optional(),
    booking: z.strictObject(bookingShape).optional(),
    staff: staffClockSchema.optional(),
  }),
) {}
