import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { isSessionRecordsRangeAllowed, MAX_SESSION_NOTES_LENGTH } from '../domain/session-record';
import { bookingShape } from './booking.dto';

/** El cuerpo es opcional: terminar la clase sin notas no necesita enviar nada. */
export class EndSessionRequestDto extends createZodDto(
  z
    .strictObject({
      notes: z.string().trim().max(MAX_SESSION_NOTES_LENGTH).optional(),
    })
    .default({}),
) {}

export class SessionRecordsQueryDto extends createZodDto(
  z
    .strictObject({
      from: z.iso.date(),
      to: z.iso.date(),
      staffMembershipId: z.uuid().optional(),
    })
    .refine((query) => isSessionRecordsRangeAllowed(query.from, query.to), {
      path: ['to'],
      error: 'to must not be before from, nor more than 31 days after the first day (inclusive)',
    }),
) {}

const personShape = { membershipId: z.uuid(), fullName: z.string() };

export class SessionRecordsResponseDto extends createZodDto(
  z.strictObject({
    /** Zona horaria del centro: `from` y `to` son días en ella. */
    timezone: z.string(),
    records: z.array(
      z.strictObject({
        booking: z.strictObject(bookingShape),
        client: z.strictObject(personShape),
        staff: z.strictObject(personShape),
        plannedDurationSeconds: z.number().int(),
        actualDurationSeconds: z.number().int().nullable(),
        /** Iniciada y todavía sin terminar. */
        isOpen: z.boolean(),
        notes: z.string().nullable(),
      }),
    ),
    totals: z.array(
      z.strictObject({
        staffMembershipId: z.uuid(),
        staffName: z.string(),
        /** Clases cerradas. */
        classCount: z.number().int(),
        /** Duración prevista de las clases cerradas, para compararla con la real. */
        plannedSeconds: z.number().int(),
        actualSeconds: z.number().int(),
        openCount: z.number().int(),
      }),
    ),
  }),
) {}
