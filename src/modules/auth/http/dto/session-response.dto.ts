import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';

const MAX_CHALLENGE_TOKEN_LENGTH = 2048;

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
  /** Con qué puede completar el acceso. El principal va primero; `email` siempre está disponible. */
  methods: z.array(z.enum(['totp', 'email'])).min(1),
  /** Correo enmascarado (`a***@dominio.com`) al que llegaría el código si elige `email`. */
  emailHint: z.string(),
});

/** Cuerpo de `POST /auth/mfa/email/send`: el desafío que recibió al acertar la contraseña. */
export class MfaEmailSendRequestDto extends createZodDto(
  z.strictObject({ mfaToken: z.string().min(1).max(MAX_CHALLENGE_TOKEN_LENGTH) }),
) {}

/** Sesión abierta. Es también la respuesta de completar el segundo factor (sesión marcada con segundo factor). */
export class MfaLoginResponseDto extends createZodDto(authenticatedLoginSchema) {}

/** Desafío de segundo factor. El inicio de sesión responde con este o con `MfaLoginResponseDto`. */
export class MfaChallengeResponseDto extends createZodDto(mfaRequiredLoginSchema) {}

/** Respuesta de la renovación: solo tokens nuevos (la app ya tiene los datos de la persona). */
export class RefreshResponseDto extends createZodDto(z.strictObject(sessionTokensShape)) {}
