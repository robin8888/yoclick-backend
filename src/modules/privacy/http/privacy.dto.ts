import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

export class PrivacyRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class ConsentSummaryResponseDto extends createZodDto(
  z.strictObject({
    /** Clientes activos del centro. */
    clientCount: z.number().int(),
    privacy: z.number().int(),
    health: z.number().int(),
    marketing: z.number().int(),
    image: z.number().int(),
    parental: z.number().int(),
  }),
) {}
