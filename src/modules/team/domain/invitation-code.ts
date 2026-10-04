import { createHash, randomInt } from 'node:crypto';

/** Sin I, O, 0 ni 1: el código se teclea desde un correo. 31^12 combinaciones (~59 bits). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const GROUP_LENGTH = 4;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;
export const INVITATION_VALID_DAYS = 7;

export function generateInvitationCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** `ABCDEFGHJKLM` → `ABCD-EFGH-JKLM`, para leerlo y teclearlo sin errores. */
export function formatInvitationCode(code: string): string {
  const groupCount = Math.ceil(code.length / GROUP_LENGTH);
  return Array.from({ length: groupCount }, (_unused, index) =>
    code.slice(index * GROUP_LENGTH, (index + 1) * GROUP_LENGTH),
  ).join('-');
}

/** Tolera guiones, espacios y minúsculas; devuelve `null` si no puede ser un código nuestro. */
export function normalizeInvitationCode(rawCode: string): string | null {
  const compact = rawCode.replace(/[\s-]/g, '').toUpperCase();
  const isWellFormed = CODE_PATTERN.test(compact);
  return isWellFormed ? compact : null;
}

/** Se guarda solo el hash: quien lea la base de datos no puede usar una invitación pendiente. */
export function hashInvitationCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** `robin@yopmail.com` → `r***@yopmail.com`: reconocible para su dueña, inútil para un tercero. */
export function maskEmailAddress(email: string): string {
  const [localPart = '', domain = ''] = email.split('@');
  return `${localPart.slice(0, 1)}***@${domain}`;
}
