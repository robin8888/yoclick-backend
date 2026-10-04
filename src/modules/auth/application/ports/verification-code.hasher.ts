/** Firma los códigos de 6 dígitos antes de guardarlos: la base de datos nunca contiene un código utilizable. */
export interface VerificationCodeHasher {
  hash(code: string): string;
  matches(code: string, storedHash: string): boolean;
}

export const VERIFICATION_CODE_HASHER = Symbol('VERIFICATION_CODE_HASHER');
