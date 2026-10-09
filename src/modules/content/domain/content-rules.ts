const BYTES_PER_MEGABYTE = 1_048_576;
const MAX_DOCUMENT_SIZE_MEGABYTES = 50;
export const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MEGABYTES * BYTES_PER_MEGABYTE;
export const PDF_CONTENT_TYPE = 'application/pdf';
export const MAX_CONTENT_TITLE_LENGTH = 120;
export const MAX_CONTENT_NEED_LENGTH = 40;

const PDF_SIGNATURE = '%PDF-';
/** Cada página de un PDF es un objeto `/Type /Page`; `/Pages` es el árbol que las agrupa y no cuenta. */
const PDF_PAGE_OBJECT = /\/Type\s*\/Page(?!\w)/g;

/** Un PDF de verdad empieza por `%PDF-`; la extensión o el tipo que diga el móvil no se fían. */
export function isPdfFile(bytes: Buffer): boolean {
  return bytes.subarray(0, PDF_SIGNATURE.length).toString('latin1') === PDF_SIGNATURE;
}

/** Número de páginas aproximado: los PDF con objetos comprimidos pueden no mostrarlas y dan `null`. */
export function countPdfPages(bytes: Buffer): number | null {
  const pageCount = bytes.toString('latin1').match(PDF_PAGE_OBJECT)?.length ?? 0;
  return pageCount > 0 ? pageCount : null;
}

export type DocumentUploadDecision = 'allowed' | 'too_large' | 'quota_exceeded';

export interface DocumentUploadFacts {
  readonly storageLimitBytes: bigint;
  readonly usedBytes: bigint;
  readonly requestedBytes: bigint;
}

/** El plan fija cuánto cabe; la app solo avisa, esto es lo que manda. */
export function decideDocumentUpload(facts: DocumentUploadFacts): DocumentUploadDecision {
  if (facts.requestedBytes > BigInt(MAX_DOCUMENT_SIZE_BYTES)) return 'too_large';
  const isOverQuota = facts.usedBytes + facts.requestedBytes > facts.storageLimitBytes;
  return isOverQuota ? 'quota_exceeded' : 'allowed';
}

export type ContentTarget =
  | { readonly kind: 'level'; readonly level: 'beginner' | 'intermediate' | 'advanced' }
  | { readonly kind: 'group'; readonly groupId: string }
  | { readonly kind: 'client'; readonly membershipId: string };

function describeTargetKey(target: ContentTarget): string {
  if (target.kind === 'level') return `level:${target.level}`;
  if (target.kind === 'group') return `group:${target.groupId}`;
  return `client:${target.membershipId}`;
}

/** Lo que ya no estaba asignado antes: solo a esos destinos se les avisa, no a quien ya lo tenía. */
export function selectAddedTargets(
  previousTargets: readonly ContentTarget[],
  nextTargets: readonly ContentTarget[],
): ContentTarget[] {
  const previousKeys = new Set(previousTargets.map(describeTargetKey));
  return nextTargets.filter((target) => !previousKeys.has(describeTargetKey(target)));
}

/** Ruta del PDF en el almacén: por centro, para que un fichero nunca se confunda con el de otro. */
export function buildDocumentKey(request: { centerId: string; contentId: string }): string {
  return `${request.centerId}/${request.contentId}.pdf`;
}
