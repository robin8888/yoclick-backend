export interface StoredCenterLogo {
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly sha256: string;
}

export interface CenterLogoReader {
  /** `null` si el centro no existe, está suspendido o no tiene logo. */
  findPublicLogo(centerId: string): Promise<StoredCenterLogo | null>;
}

export const CENTER_LOGO_READER = Symbol('CENTER_LOGO_READER');
