export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  /** Fecha sin hora, `YYYY-MM-DD`. */
  readonly birthDate: string | null;
  readonly locale: string;
  readonly isEmailVerified: boolean;
  readonly createdAt: Date;
}

/** Solo las claves presentes se modifican; `null` borra el valor. */
export interface ProfilePatch {
  readonly fullName?: string | undefined;
  readonly phone?: string | null | undefined;
  readonly birthDate?: string | null | undefined;
  readonly locale?: string | undefined;
}

export interface MyMembership {
  readonly membershipId: string;
  readonly centerId: string;
  readonly role: 'owner' | 'admin' | 'staff' | 'client';
  readonly status: 'invited' | 'active' | 'blocked' | 'left';
  readonly joinedAt: Date;
  /** Resumen de marca para pintar "Mis centros" sin una segunda petición. */
  readonly center: {
    readonly name: string;
    readonly slug: string;
    readonly sectorId: string;
    readonly brandColor: string;
  };
}

export type ChangeableConsentKind = 'marketing' | 'image';

export interface ConsentState {
  readonly kind: 'privacy' | 'terms' | 'marketing' | 'health' | 'image' | 'parental';
  readonly version: string;
  readonly isGranted: boolean;
  readonly grantedAt: Date;
}

export interface NewConsentChange {
  readonly kind: ChangeableConsentKind;
  readonly version: string;
  readonly isGranted: boolean;
}

export interface ProfileRepository {
  /** `null` si la cuenta no existe o fue eliminada. */
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<Profile | null>;
  /** Todas las membresías de la persona, salvo las que dejó (`left`). */
  listMemberships(userId: string): Promise<MyMembership[]>;
  /** El estado vigente de cada tipo de consentimiento (la fila más reciente de cada uno). */
  listLatestConsents(userId: string): Promise<ConsentState[]>;
  /** Todo el historial, para el derecho de acceso y portabilidad. */
  listConsentHistory(userId: string): Promise<ConsentState[]>;
  /** Cambiar un consentimiento es AÑADIR una fila: el historial es inmutable. */
  recordConsent(userId: string, change: NewConsentChange): Promise<void>;
}

export const PROFILE_REPOSITORY = Symbol('PROFILE_REPOSITORY');
