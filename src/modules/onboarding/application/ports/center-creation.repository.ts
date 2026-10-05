export interface NewCenter {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly sectorId: string;
  readonly brandColor: string;
  readonly city: string | null;
  readonly isListed: boolean;
  readonly joinCode: string;
  readonly trialEndsAt: Date;
}

export type CenterCreationResult =
  | { readonly kind: 'created'; readonly ownerMembershipId: string }
  /** El slug o el código de unión ya existían: el llamante genera otros y reintenta. */
  | { readonly kind: 'identifier_taken' }
  | { readonly kind: 'owner_limit_reached' };

export interface CenterCreationRepository {
  /** Crea el centro y la membresía de su propietario en una sola transacción. */
  createWithOwner(
    center: NewCenter,
    ownerUserId: string,
    maxOwnedCenters: number,
  ): Promise<CenterCreationResult>;
}

export const CENTER_CREATION_REPOSITORY = Symbol('CENTER_CREATION_REPOSITORY');
