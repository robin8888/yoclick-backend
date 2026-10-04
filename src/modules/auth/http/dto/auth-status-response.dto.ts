import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Respuesta deliberadamente igual exista o no la cuenta: no revela nada que sirva para averiguar
 * qué correos están registrados. Lo que cambia (un código, un aviso) llega solo al buzón.
 */
export class VerificationSentResponseDto extends createZodDto(
  z.strictObject({ status: z.literal('verification_sent') }),
) {}

export class EmailVerifiedResponseDto extends createZodDto(
  z.strictObject({ status: z.literal('verified') }),
) {}
