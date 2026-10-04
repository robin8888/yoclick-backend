import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';
import { emailAddressSchema } from './email-address.schema';

export class ResendEmailVerificationRequestDto extends createZodDto(
  z.strictObject({ email: emailAddressSchema }),
) {}
