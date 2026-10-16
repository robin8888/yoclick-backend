import { type TotpConfirmation } from '../application/confirm-totp.use-case';

/** La respuesta de activar el segundo factor: los códigos de recuperación y la sesión ya verificada. */
export function serializeMfaConfirmation({
  recoveryCodes,
  session,
}: TotpConfirmation): Record<string, unknown> {
  return {
    recoveryCodes,
    session: {
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
    },
  };
}
