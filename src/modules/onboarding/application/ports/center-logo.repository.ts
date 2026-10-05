import { type LogoContentType } from '../../domain/center-logo-image';

export interface NewCenterLogo {
  readonly contentType: LogoContentType;
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly uploadedAt: Date;
}

export type CenterLogoSaveResult =
  | { readonly kind: 'saved' }
  /** Quien sube no es propietario activo de ese centro, o el centro no existe. */
  | { readonly kind: 'not_owner' };

export interface CenterLogoRepository {
  /** Guarda el logo (sustituyendo el anterior) solo si `ownerUserId` es propietario activo del centro. */
  saveForOwner(
    ownerUserId: string,
    centerId: string,
    logo: NewCenterLogo,
  ): Promise<CenterLogoSaveResult>;
}

export const CENTER_LOGO_REPOSITORY = Symbol('CENTER_LOGO_REPOSITORY');
