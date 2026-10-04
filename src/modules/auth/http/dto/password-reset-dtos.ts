import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';
import { emailAddressSchema } from './email-address.schema';

const MAX_PASSWORD_LENGTH_ACCEPTED = 256;

export class ForgotPasswordRequestDto extends createZodDto(
  z.strictObject({ email: emailAddressSchema }),
) {}

export class ResetPasswordRequestDto extends createZodDto(
  z.strictObject({
    email: emailAddressSchema,
    code: z.string().regex(/^\d{6}$/),
    /** La política (10-128, no contener el correo, no filtrada) la aplica el dominio con su propio código de error. */
    newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
  }),
) {}

/** Igual exista o no la cuenta (SEC-46). */
export class PasswordResetRequestedResponseDto extends createZodDto(
  z.strictObject({ status: z.literal('reset_requested') }),
) {}

export class PasswordChangedResponseDto extends createZodDto(
  z.strictObject({ status: z.literal('password_changed') }),
) {}
