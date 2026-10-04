import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { refreshTokenFieldSchema } from './refresh-token-field.schema';

export class LogoutRequestDto extends createZodDto(
  z.strictObject({
    /** El token del dispositivo que cierra sesión. Sin él, solo tiene efecto `everywhere`. */
    refreshToken: refreshTokenFieldSchema.optional(),
    /** Cierra la sesión en todos los dispositivos. */
    everywhere: z.boolean().default(false),
  }),
) {}
