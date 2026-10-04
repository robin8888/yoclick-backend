import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { emailAddressSchema } from './email-address.schema';

const MAX_PASSWORD_LENGTH_ACCEPTED = 256;
const MAX_DEVICE_NAME_LENGTH = 100;

export class LoginRequestDto extends createZodDto(
  z.strictObject({
    email: emailAddressSchema,
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
    /** Nombre del dispositivo para que la persona reconozca sus sesiones ("iPhone de Robin"). */
    deviceName: z.string().trim().min(1).max(MAX_DEVICE_NAME_LENGTH).optional(),
  }),
) {}
