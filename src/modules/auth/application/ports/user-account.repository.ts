export interface UserAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
}

export interface LockoutPolicy {
  readonly maxFailedAttempts: number;
  readonly lockDurationMs: number;
  readonly now: Date;
}

export interface FailedLoginOutcome {
  /** `true` si este intento fue el que alcanzó el límite y bloqueó la cuenta. */
  readonly isNowLocked: boolean;
}

export type RegistrationConsentKind = 'privacy' | 'terms' | 'marketing';

export interface NewConsent {
  readonly kind: RegistrationConsentKind;
  /** Versión del texto legal que se aceptó. */
  readonly version: string;
  readonly isGranted: boolean;
}

export interface NewUserAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly consents: readonly NewConsent[];
  /** Hash del IP desde el que se registró (evidencia del consentimiento sin guardar el IP). */
  readonly ipHash: string | null;
}

export type CreateUserAccountResult = 'created' | 'email-taken';

export interface UserAccountRepository {
  findByEmail(email: string): Promise<UserAccount | null>;
  /** Para quien ya está autenticada (reautenticación). Una cuenta eliminada no se devuelve. */
  findById(userId: string): Promise<UserAccount | null>;
  /** Crea la cuenta y sus consentimientos juntos, o nada. `email-taken` si otra petición se adelantó. */
  create(newUser: NewUserAccount): Promise<CreateUserAccountResult>;
  markEmailVerified(userId: string, verifiedAt: Date): Promise<void>;
  /**
   * Guarda una contraseña nueva y levanta cualquier bloqueo. Si el correo aún no estaba confirmado lo
   * confirma: recibir el código de recuperación en ese buzón es la misma prueba que verificarlo.
   */
  changePassword(userId: string, newPasswordHash: string, changedAt: Date): Promise<void>;
  /** Cuenta un intento fallido de forma atómica; al llegar al límite bloquea la cuenta y reinicia la cuenta. */
  recordFailedLogin(userId: string, policy: LockoutPolicy): Promise<FailedLoginOutcome>;
  /** Reinicia el contador, anota el acceso y, si se indica, guarda un hash recalculado con parámetros nuevos. */
  recordSuccessfulLogin(userId: string, now: Date, upgradedPasswordHash?: string): Promise<void>;
}

export const USER_ACCOUNT_REPOSITORY = Symbol('USER_ACCOUNT_REPOSITORY');
