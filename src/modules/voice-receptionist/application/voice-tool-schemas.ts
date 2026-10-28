import { z } from 'zod';

const MIN_GUEST_NAME_LENGTH = 2;
const MAX_GUEST_NAME_LENGTH = 80;
const MAX_TRANSFER_REASON_LENGTH = 200;
const MAX_SPOKEN_CODE_LENGTH = 40;

/**
 * Lo que el modelo de lenguaje puede mandar en cada herramienta. Estrictos: un campo de más (p. ej. un
 * `centerId` o un `membershipId` inventados) se rechaza. El centro y la persona salen siempre de la llamada.
 */
export const VOICE_TOOL_NAMES = [
  'getAvailableSessions',
  'identifyCaller',
  'getCallerBookings',
  'createBookingForCaller',
  'cancelBookingForCaller',
  'rescheduleBookingForCaller',
  'addCallerToWaitlist',
  'transferCallToHuman',
] as const;

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];

const startsAtSchema = z.iso.datetime({ offset: true });

export const getAvailableSessionsArguments = z.strictObject({
  /** Sin servicio, devuelve los servicios que se pueden reservar. */
  serviceId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const identifyCallerArguments = z.strictObject({
  /** Lo que el transcriptor oyó del código; se limpia y se exigen 6 cifras. */
  studentCode: z.string().max(MAX_SPOKEN_CODE_LENGTH).optional(),
});

export const getCallerBookingsArguments = z.strictObject({});

export const createBookingArguments = z.strictObject({
  serviceId: z.uuid(),
  startsAt: startsAtSchema,
  /** Clase grupal concreta, en lugar de una hora libre. */
  classSessionId: z.uuid().optional(),
  /** Solo si quien llama no es alumno ni cliente: su nombre, para darle de alta como invitado. */
  guestFullName: z.string().trim().min(MIN_GUEST_NAME_LENGTH).max(MAX_GUEST_NAME_LENGTH).optional(),
});

export const cancelBookingArguments = z.strictObject({ bookingId: z.uuid() });

export const rescheduleBookingArguments = z.strictObject({
  bookingId: z.uuid(),
  startsAt: startsAtSchema,
});

export const addToWaitlistArguments = z.strictObject({ classSessionId: z.uuid() });

export const transferCallArguments = z.strictObject({
  reason: z.string().trim().max(MAX_TRANSFER_REASON_LENGTH).optional(),
});

export type GetAvailableSessionsArguments = z.infer<typeof getAvailableSessionsArguments>;
export type IdentifyCallerArguments = z.infer<typeof identifyCallerArguments>;
export type CreateBookingArguments = z.infer<typeof createBookingArguments>;
export type CancelBookingArguments = z.infer<typeof cancelBookingArguments>;
export type RescheduleBookingArguments = z.infer<typeof rescheduleBookingArguments>;
export type AddToWaitlistArguments = z.infer<typeof addToWaitlistArguments>;
export type TransferCallArguments = z.infer<typeof transferCallArguments>;
