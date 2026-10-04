export type PasswordPolicyViolation = 'too_short' | 'too_long' | 'contains_email';

export const MIN_PASSWORD_LENGTH = 10;
/** Tope que evita enviar al hasher textos enormes (un argon2id con 1 MB de entrada es una palanca de DoS). */
export const MAX_PASSWORD_LENGTH = 128;
const MIN_EMAIL_NAME_LENGTH_TO_COMPARE = 4;

/**
 * Política de contraseñas (SEC-43): longitud mínima y nada de reglas de composición absurdas
 * ("una mayúscula, un símbolo..."), que empujan a elegir `Password1!`. Se cuentan caracteres, no bytes.
 * Que la contraseña no esté en filtraciones conocidas lo comprueba otro puerto, no esta función pura.
 */
export function findPasswordPolicyViolations(
  password: string,
  email: string,
): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];
  const passwordLength = Array.from(password).length;

  if (passwordLength < MIN_PASSWORD_LENGTH) violations.push('too_short');
  if (passwordLength > MAX_PASSWORD_LENGTH) violations.push('too_long');

  const emailName = (email.split('@')[0] ?? '').toLowerCase();
  const canCompareEmailName = emailName.length >= MIN_EMAIL_NAME_LENGTH_TO_COMPARE;
  if (canCompareEmailName && password.toLowerCase().includes(emailName)) {
    violations.push('contains_email');
  }

  return violations;
}
