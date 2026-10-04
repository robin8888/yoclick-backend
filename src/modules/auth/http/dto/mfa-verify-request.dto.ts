import { createZodDto } from 'nestjs-zod';
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

/** Exactamente uno de los dos: el código de la app o un código de recuperación. */
export function hasExactlyOneSecondFactorCode(body: {
  code?: unknown;
  recoveryCode?: unknown;
}): boolean {
  return (body.code === undefined) !== (body.recoveryCode === undefined);
}

export class MfaVerifyRequestDto extends createZodDto(
  z
    .strictObject({
      mfaToken: z.string().min(1).max(MAX_CHALLENGE_TOKEN_LENGTH),
      code: totpCodeSchema.optional(),
      recoveryCode: recoveryCodeFieldSchema.optional(),
      deviceName: z.string().trim().min(1).max(MAX_DEVICE_NAME_LENGTH).optional(),
    })
    .refine(hasExactlyOneSecondFactorCode, 'send either code or recoveryCode, not both'),
) {}
