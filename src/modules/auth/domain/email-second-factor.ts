import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { MIN_SECONDS_BETWEEN_CODES } from './verification-code';

export type SecondFactorMethod = 'totp' | 'email';

/** El código por correo caduca a los 10 minutos: lo justo para abrir el buzón y escribirlo. */
export const EMAIL_SECOND_FACTOR_CODE_TTL_MINUTES = 10;

const MASKED_LOCAL_PART_SUFFIX = '***';

/**
 * Enseña a qué buzón llegará el código sin publicar el correo entero: `a***@yopmail.com`. Solo se
 * muestra a quien ya demostró la contraseña (o va autenticada).
 */
export function maskEmailAddress(email: string): string {
  const separatorIndex = email.lastIndexOf('@');
  if (separatorIndex <= 0) return MASKED_LOCAL_PART_SUFFIX;
  const firstCharacter = email.slice(0, 1);
  return `${firstCharacter}${MASKED_LOCAL_PART_SUFFIX}${email.slice(separatorIndex)}`;
}

/** ¿Se pidió un código hace menos de 60 s? Frena el envío masivo de correos a un buzón. */
export function isResendTooSoon(lastIssuedAt: Date, now: Date): boolean {
  const cooldownMs = MIN_SECONDS_BETWEEN_CODES * MILLISECONDS_PER_SECOND;
  return now.getTime() - lastIssuedAt.getTime() < cooldownMs;
}

/**
 * Qué puede usar la persona para entrar. El correo está siempre disponible mientras tenga segundo
 * factor: es la alternativa cuando no tiene a mano su aplicación. El principal va primero.
 */
export function listLoginMethods(primaryMethod: SecondFactorMethod): SecondFactorMethod[] {
  return primaryMethod === 'totp' ? ['totp', 'email'] : ['email'];
}
