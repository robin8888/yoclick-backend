export interface UserAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
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
  /** Crea la cuenta y sus consentimientos juntos, o nada. `email-taken` si otra petición se adelantó. */
  create(newUser: NewUserAccount): Promise<CreateUserAccountResult>;
  markEmailVerified(userId: string, verifiedAt: Date): Promise<void>;
}

export const USER_ACCOUNT_REPOSITORY = Symbol('USER_ACCOUNT_REPOSITORY');
