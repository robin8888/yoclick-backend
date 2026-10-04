import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { emailAddressSchema } from './email-address.schema';

export class ResendEmailVerificationRequestDto extends createZodDto(
  z.strictObject({ email: emailAddressSchema }),
) {}
