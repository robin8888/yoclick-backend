import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 100;

export class ActivityRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class ActivityQueryDto extends createZodDto(
  z.strictObject({
    limit: z.coerce.number().int().min(1).max(MAX_ACTIVITY_LIMIT).default(DEFAULT_ACTIVITY_LIMIT),
  }),
) {}

export class ActivityResponseDto extends createZodDto(
  z.strictObject({
    entries: z.array(
      z.strictObject({
        id: z.uuid(),
        /** `service_updated`, `client_updated`… la frase se compone en la app. */
        kind: z.string(),
        subject: z.string().nullable(),
        actorName: z.string().nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
) {}
