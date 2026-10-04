import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const sessionTokensShape = {
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
};

const authenticatedLoginSchema = z.strictObject({
  status: z.literal('authenticated'),
  ...sessionTokensShape,
  user: z.strictObject({ id: z.uuid(), email: z.string(), fullName: z.string() }),
});

/** La contraseña era correcta pero la cuenta tiene segundo factor: falta enviar el código. */
const mfaRequiredLoginSchema = z.strictObject({
  status: z.literal('mfa_required'),
  /** Desafío de 5 minutos que se cambia por la sesión en `POST /auth/mfa/verify`. No es un token de acceso. */
  mfaToken: z.string(),
  mfaTokenExpiresAt: z.iso.datetime(),
});

/** Sesión abierta. Es también la respuesta de completar el segundo factor (sesión marcada con segundo factor). */
export class MfaLoginResponseDto extends createZodDto(authenticatedLoginSchema) {}

/** Desafío de segundo factor. El inicio de sesión responde con este o con `MfaLoginResponseDto`. */
export class MfaChallengeResponseDto extends createZodDto(mfaRequiredLoginSchema) {}

/** Respuesta de la renovación: solo tokens nuevos (la app ya tiene los datos de la persona). */
export class RefreshResponseDto extends createZodDto(z.strictObject(sessionTokensShape)) {}
