import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';

const MAX_CHALLENGE_TOKEN_LENGTH = 2048;
const MAX_RECOVERY_CODE_LENGTH = 24;
const MAX_DEVICE_NAME_LENGTH = 100;
const MIN_RECOVERY_CODE_LENGTH = 8;

export const totpCodeSchema = z.string().regex(/^\d{6}$/);
export const recoveryCodeFieldSchema = z
  .string()
  .trim()
  .min(MIN_RECOVERY_CODE_LENGTH)
  .max(MAX_RECOVERY_CODE_LENGTH);

/** Exactamente uno: el código de la app (`code`), el recibido por correo (`emailCode`) o uno de recuperación. */
export function hasExactlyOneSecondFactorCode(body: {
  code?: unknown;
  emailCode?: unknown;
  recoveryCode?: unknown;
}): boolean {
  const providedCodes = [body.code, body.emailCode, body.recoveryCode].filter(
    (candidate) => candidate !== undefined,
  );
  return providedCodes.length === 1;
}

export class MfaVerifyRequestDto extends createZodDto(
  z
    .strictObject({
      mfaToken: z.string().min(1).max(MAX_CHALLENGE_TOKEN_LENGTH),
      code: totpCodeSchema.optional(),
      emailCode: totpCodeSchema.optional(),
      recoveryCode: recoveryCodeFieldSchema.optional(),
      deviceName: z.string().trim().min(1).max(MAX_DEVICE_NAME_LENGTH).optional(),
    })
    .refine(hasExactlyOneSecondFactorCode, 'send exactly one of code, emailCode or recoveryCode'),
) {}
