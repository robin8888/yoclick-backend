import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Esquema del error RFC 9457 para el contrato OpenAPI: todas las respuestas de error tienen esta forma. */
export class ProblemDetailsDto extends createZodDto(
  z.object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    traceId: z.string(),
    errors: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
  }),
) {}
