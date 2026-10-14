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

/** Qui�n es la persona escaneada, para que la app la muestre antes de dejarla pasar. */
const scannedPersonSchema = z.strictObject({
  membershipId: z.uuid(),
  fullName: z.string(),
  photoUrl: z.string().nullable(),
  role: z.enum(['client', 'staff', 'admin', 'owner']),
});

const accessPassSchema = z.strictObject({
  name: z.string(),
  remainingSessions: z.number().int(),
  totalSessions: z.number().int(),
  expiresAt: z.iso.datetime().nullable(),
});

/** Si puede entrar y por qu�; en rojo (`isGranted: false`) `reason` dice qu� le falta. */
const accessSchema = z.strictObject({
  isGranted: z.boolean(),
  reason: z.enum([
    'valid_pass',
    'team_member',
    'passes_not_required',
    'no_pass',
    'pass_pending',
    'pass_expired',
    'pass_exhausted',
  ]),
  pass: accessPassSchema.nullable(),
});

/**
 * Siempre trae `person` y `access`. `kind: 'client'`: si `access.isGranted` y tiene cita ahora trae la
 * llegada (`booking`, `checkedInAt`, `isFirstCheckIn`); sin acceso o sin cita no se registra nada y
 * `booking` y `checkedInAt` no vienen. `kind: 'staff'` trae el fichaje en `staff`.
 */
export class CheckInResponseDto extends createZodDto(
  z.strictObject({
    kind: z.enum(['client', 'staff']),
    person: scannedPersonSchema,
    access: accessSchema,
    clientFullName: z.string().optional(),
    /** Solo si se ha registrado (o ya estaba registrada) la llegada a una cita. */
    checkedInAt: z.iso.datetime().nullish(),
    /** `false` si esa llegada ya estaba registrada o no se ha registrado ninguna. */
    isFirstCheckIn: z.boolean().optional(),
    booking: z.strictObject(bookingShape).optional(),
    staff: staffClockSchema.optional(),
  }),
) {}
