import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';
import { emailAddressSchema } from './email-address.schema';

export class VerifyEmailRequestDto extends createZodDto(
  z.strictObject({ email: emailAddressSchema, code: z.string().regex(/^\d{6}$/) }),
) {}
