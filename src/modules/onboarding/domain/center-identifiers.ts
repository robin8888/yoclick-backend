import { randomInt } from 'node:crypto';

/** Sin I, O, 0 ni 1: un código que se lee en un cartel o se dicta por teléfono no se confunde. */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
const MAX_SLUG_BASE_LENGTH = 40;
const SLUG_SUFFIX_LENGTH = 4;
const SLUG_SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const FALLBACK_SLUG_BASE = 'centro';

export function generateJoinCode(): string {
  return Array.from(
    { length: JOIN_CODE_LENGTH },
    () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)],
  ).join('');
}

/** "Studio Norte ¡Madrid!" → "studio-norte-madrid": minúsculas, sin acentos, solo letras, números y guiones. */
export function slugifyCenterName(name: string): string {
  const joinedWords = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]/)
    .filter((word) => word !== '')
    .join('-');
  // Los guiones nunca van seguidos, así que como mucho sobra uno al cortar.
  const slug = joinedWords.slice(0, MAX_SLUG_BASE_LENGTH).replace(/-$/, '');
  return slug === '' ? FALLBACK_SLUG_BASE : slug;
}

/** Tras un choque con otro centro del mismo nombre, un sufijo corto y aleatorio lo distingue. */
export function addRandomSuffix(slug: string): string {
  const suffix = Array.from(
    { length: SLUG_SUFFIX_LENGTH },
    () => SLUG_SUFFIX_ALPHABET[randomInt(SLUG_SUFFIX_ALPHABET.length)],
  ).join('');
  return `${slug}-${suffix}`;
}
