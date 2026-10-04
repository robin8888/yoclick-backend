import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RECOVERY_CODE_COUNT } from '../../domain/recovery-code';
import {
  hasExactlyOneSecondFactorCode,
  recoveryCodeFieldSchema,
  totpCodeSchema,
} from './mfa-verify-request.dto';

const MAX_PASSWORD_LENGTH_ACCEPTED = 256;

export class MfaSetupRequestDto extends createZodDto(
  z.strictObject({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED) }),
) {}

export class MfaSetupResponseDto extends createZodDto(
  z.strictObject({
    /** Base32, para quien prefiera teclearlo. Se enseña una sola vez. */
    secret: z.string(),
    /** `otpauth://` para convertirlo en QR. */
    provisioningUri: z.string(),
  }),
) {}

export class MfaConfirmRequestDto extends createZodDto(z.strictObject({ code: totpCodeSchema })) {}

export class MfaConfirmResponseDto extends createZodDto(
  z.strictObject({
    /** Diez códigos de un solo uso. Se enseñan UNA vez: hay que guardarlos. */
    recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
  }),
) {}

export class MfaStatusResponseDto extends createZodDto(
  z.strictObject({ isEnabled: z.boolean(), recoveryCodesRemaining: z.number().int().min(0) }),
) {}

/** Contraseña más una prueba del propio segundo factor: el código de la app o uno de recuperación. */
export class MfaProofRequestDto extends createZodDto(
  z
    .strictObject({
      password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED),
      code: totpCodeSchema.optional(),
      recoveryCode: recoveryCodeFieldSchema.optional(),
    })
    .refine(hasExactlyOneSecondFactorCode, 'send either code or recoveryCode, not both'),
) {}

export class RegeneratedRecoveryCodesResponseDto extends createZodDto(
  z.strictObject({ recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT) }),
) {}
