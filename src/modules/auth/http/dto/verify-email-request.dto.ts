import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { emailAddressSchema } from './email-address.schema';

export class VerifyEmailRequestDto extends createZodDto(
  z.strictObject({ email: emailAddressSchema, code: z.string().regex(/^\d{6}$/) }),
) {}
