import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const sessionTokensShape = {
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
};

/** Respuesta del inicio de sesión: los tokens y los datos mínimos de la persona. */
export class LoginResponseDto extends createZodDto(
  z.strictObject({
    ...sessionTokensShape,
    user: z.strictObject({ id: z.uuid(), email: z.string(), fullName: z.string() }),
  }),
) {}

/** Respuesta de la renovación: solo tokens nuevos (la app ya tiene los datos de la persona). */
export class RefreshResponseDto extends createZodDto(z.strictObject(sessionTokensShape)) {}
