import { type ActorContext } from '../../../../shared/tenancy/actor-context';

export type MemberPhotoRemoval =
  | { readonly kind: 'removed'; readonly previousKey: string | null }
  | { readonly kind: 'not_found' };

/** La foto de perfil de una persona: una sola, global, que vive en `users`. */
export interface PhotoRepository {
  /** Guarda la nueva foto y devuelve la anterior; `null` si la cuenta no existe. */
  replaceAvatar(userId: string, newKey: string): Promise<{ previousKey: string | null } | null>;
  /** Quita la foto y devuelve la ruta que tenía. */
  removeAvatar(userId: string): Promise<string | null>;
  /** Moderación: quita la foto de otra persona del centro. */
  removeMemberAvatar(actor: ActorContext, membershipId: string): Promise<MemberPhotoRemoval>;
}

export const PHOTO_REPOSITORY = Symbol('PHOTO_REPOSITORY');
