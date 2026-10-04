import { randomInt } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;
const GROUP_LENGTH = 5;
/** Sin 0, 1, O, I ni L: un código que se copia a mano desde un papel no puede ser ambiguo. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateGroup(): string {
  return Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/**
 * 10 códigos de un solo uso para entrar si se pierde el dispositivo del segundo factor. Cada uno son
 * 10 caracteres de un alfabeto de 31 (~50 bits), con aleatoriedad criptográfica.
 */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => `${generateGroup()}-${generateGroup()}`);
}

/** Mayúsculas y sin guion ni espacios: da igual cómo lo teclee la persona. */
export function normalizeRecoveryCode(typedCode: string): string {
  return typedCode.replaceAll(/[\s-]/g, '').toUpperCase();
}
