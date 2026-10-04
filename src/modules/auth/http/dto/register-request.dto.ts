import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { emailAddressSchema } from './email-address.schema';

const MIN_FULL_NAME_LENGTH = 2;
const MAX_FULL_NAME_LENGTH = 100;
/** Corte barato antes del hash; la política (10–128) la aplica el dominio con su propio código de error. */
const MAX_PASSWORD_LENGTH_ACCEPTED = 256;

export class RegisterRequestDto extends createZodDto(
  z.strictObject({
    email: emailAddressSchema,
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
    fullName: z.string().trim().min(MIN_FULL_NAME_LENGTH).max(MAX_FULL_NAME_LENGTH),
    consents: z.strictObject({
      privacy: z.boolean(),
      terms: z.boolean(),
      marketing: z.boolean().default(false),
    }),
  }),
) {}
