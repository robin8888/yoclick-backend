export const STUDENT_CODE_LENGTH = 6;
const DECIMAL_BASE = 10;
/** Exclusivo: los códigos van de 000000 a 999999. */
export const STUDENT_CODE_RANGE = DECIMAL_BASE ** STUDENT_CODE_LENGTH;

/**
 * El código de alumno o cliente que dice por teléfono: 6 cifras. Solo cifras porque el reconocimiento de
 * voz confunde letras («be» y «de») pero no números. Recibe el número ya sorteado para ser puro y testeable.
 */
export function buildStudentCode(randomInteger: number): string {
  return String(randomInteger).padStart(STUDENT_CODE_LENGTH, '0');
}

/**
 * Lo que oye el transcriptor puede venir como «123 456», «1-2-3-4-5-6» o «123456.». Se queda con las cifras
 * y exige exactamente 6; si no, el código no existe y ni siquiera se busca.
 */
export function normalizeSpokenStudentCode(spokenCode: string): string | null {
  const digits = spokenCode.replace(/\D/g, '');
  return digits.length === STUDENT_CODE_LENGTH ? digits : null;
}
