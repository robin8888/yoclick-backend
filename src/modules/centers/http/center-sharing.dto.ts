import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

export class JoinStatsResponseDto extends createZodDto(
  z.strictObject({
    /** Mes natural en la zona horaria del centro, `AAAA-MM`. */
    month: z.string(),
    qr: z.number().int(),
    link: z.number().int(),
    code: z.number().int(),
    search: z.number().int(),
    total: z.number().int(),
  }),
) {}

export class JoinCodeResponseDto extends createZodDto(z.strictObject({ joinCode: z.string() })) {}
