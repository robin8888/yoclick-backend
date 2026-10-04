import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const MAX_PASSWORD_LENGTH_ACCEPTED = 256;
/** Lo que la persona debe escribir para confirmar el borrado (pantalla `delacct` del diseño). */
export const DELETE_ACCOUNT_CONFIRMATION_WORD = 'ELIMINAR';

export class ChangePasswordRequestDto extends createZodDto(
  z.strictObject({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
    newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
  }),
) {}

export class ExportDataRequestDto extends createZodDto(
  z.strictObject({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED) }),
) {}

export class DeleteAccountRequestDto extends createZodDto(
  z.strictObject({
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
    confirmation: z.literal(DELETE_ACCOUNT_CONFIRMATION_WORD),
  }),
) {}

export class PasswordChangedResponseDto extends createZodDto(
  z.strictObject({ status: z.literal('password_changed') }),
) {}
