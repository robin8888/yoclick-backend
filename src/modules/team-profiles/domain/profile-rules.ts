export const MAX_HEADLINE_LENGTH = 120;
export const MAX_BIO_LENGTH = 1000;
export const MAX_LIST_ITEMS = 8;
export const MAX_LIST_ITEM_LENGTH = 40;
export const MAX_CERTIFICATION_NAME_LENGTH = 120;
export const MAX_CERTIFICATION_DETAIL_LENGTH = 120;
export const MAX_CERTIFICATIONS = 10;
export const MAX_TECHNIQUE_VIDEOS = 3;
export const MAX_REVIEW_COMMENT_LENGTH = 500;
export const MAX_MOD_NOTE_LENGTH = 300;
export const MIN_RATING = 1;
export const MAX_RATING = 5;

const ONE_DECIMAL_FACTOR = 10;

export type StaffProfileStatusName = 'draft' | 'pending' | 'published' | 'changes_requested';

/** Quita los vacíos y los repetidos (sin mirar mayúsculas), recorta cada texto y respeta el máximo de la lista. */
export function normalizeTextList(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const text of texts) {
    const trimmed = text.trim().slice(0, MAX_LIST_ITEM_LENGTH);
    const key = trimmed.toLocaleLowerCase('es-ES');
    if (trimmed === '' || seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized.slice(0, MAX_LIST_ITEMS);
}

export type SubmitDecision =
  | { readonly kind: 'consent_required' }
  | { readonly kind: 'empty_profile' }
  | { readonly kind: 'ready'; readonly status: 'pending' | 'published' };

export interface SubmitFacts {
  readonly role: string;
  readonly hasPublishConsent: boolean;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly hasIntroVideo: boolean;
}

/**
 * Enviar el perfil: hace falta haber autorizado que se publique la imagen y algo que enseñar. Lo que
 * envía el equipo espera la revisión del centro; la administración lo publica directamente.
 */
export function decideProfileSubmission(facts: SubmitFacts): SubmitDecision {
  if (!facts.hasPublishConsent) return { kind: 'consent_required' };
  const hasContent = facts.headline !== null || facts.bio !== null || facts.hasIntroVideo;
  if (!hasContent) return { kind: 'empty_profile' };
  const isAdministrator = facts.role === 'owner' || facts.role === 'admin';
  return { kind: 'ready', status: isAdministrator ? 'published' : 'pending' };
}

/** Cambiar cualquier cosa del perfil lo saca de la vista de los clientes hasta que se vuelva a enviar y aprobar. */
export function resolveStatusAfterEdit(): StaffProfileStatusName {
  return 'draft';
}

export function canClientsSeeProfile(status: StaffProfileStatusName): boolean {
  return status === 'published';
}

export interface RatingSummary {
  readonly average: number;
  readonly count: number;
}

/** Media con un decimal; sin opiniones no hay media (no se enseña «0»). */
export function summarizeRatings(ratings: readonly number[]): RatingSummary | null {
  if (ratings.length === 0) return null;
  const total = ratings.reduce((sum, rating) => sum + rating, 0);
  const average = Math.round((total / ratings.length) * ONE_DECIMAL_FACTOR) / ONE_DECIMAL_FACTOR;
  return { average, count: ratings.length };
}

/** Solo se opina de una sesión que ocurrió: se escaneó la llegada o se registró su inicio y fin. */
export function isBookingEligibleForReview(booking: {
  readonly status: string;
  readonly checkedInAt: Date | null;
  readonly endedAt: Date | null;
}): boolean {
  if (booking.status === 'cancelled') return false;
  return booking.checkedInAt !== null || booking.endedAt !== null;
}

export function decideNewReviewStatus(reviewsNeedApproval: boolean): 'pending' | 'published' {
  return reviewsNeedApproval ? 'pending' : 'published';
}
