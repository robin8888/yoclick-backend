export type VerificationPurposeName = 'email_verification' | 'password_reset';

export interface ActiveVerificationCode {
  readonly id: string;
  readonly codeHash: string;
  readonly createdAt: Date;
}

export interface NewVerificationCode {
  readonly userId: string;
  readonly purpose: VerificationPurposeName;
  readonly codeHash: string;
  readonly expiresAt: Date;
}

export interface CodeReference {
  readonly userId: string;
  readonly codeId: string;
}

export interface VerificationCodeRepository {
  /** Guarda un código nuevo e invalida los anteriores del mismo propósito: solo uno vale a la vez. */
  replaceActiveCode(newCode: NewVerificationCode): Promise<void>;
  /** El código vigente (sin consumir, sin caducar), si lo hay. */
  findActiveCode(
    userId: string,
    purpose: VerificationPurposeName,
    now: Date,
  ): Promise<ActiveVerificationCode | null>;
  /** Cuenta un intento de forma atómica y devuelve el total, ANTES de comparar el código. */
  registerAttempt(reference: CodeReference): Promise<number>;
  /** Marca el código como usado. `false` si otra petición ya lo había consumido (un solo uso). */
  consume(reference: CodeReference, consumedAt: Date): Promise<boolean>;
}

export const VERIFICATION_CODE_REPOSITORY = Symbol('VERIFICATION_CODE_REPOSITORY');
