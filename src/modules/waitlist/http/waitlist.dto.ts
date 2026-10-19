import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class SessionWaitlistRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), classSessionId: z.uuid() }),
) {}

export class WaitlistEntryRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), entryId: z.uuid() }),
) {}

const waitlistEntryShape = {
  id: z.uuid(),
  /** `waiting`: en cola; `offered`: se liberó una plaza y hay que confirmarla antes de `offerExpiresAt`. */
  status: z.enum(['waiting', 'offered']),
  classSessionId: z.uuid(),
  createdAt: z.iso.datetime(),
  /** Lugar en la cola (1 = la primera); `null` cuando ya tiene una plaza ofrecida. */
  position: z.number().int().nullable(),
  offerExpiresAt: z.iso.datetime().nullable(),
  session: z.strictObject({
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    service: z.strictObject({ id: z.uuid(), name: z.string() }),
  }),
};

export class WaitlistEntryResponseDto extends createZodDto(z.strictObject(waitlistEntryShape)) {}

export class MyWaitlistResponseDto extends createZodDto(
  z.strictObject({ entries: z.array(z.strictObject(waitlistEntryShape)) }),
) {}
