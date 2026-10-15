import { detectPhotoFormat, PHOTO_FILE_EXTENSIONS } from '../../photos/domain/photo-rules';
import { isPdfFile } from '../../content/domain/content-rules';
import { type MembershipRoleName } from '../../../shared/tenancy/actor-context';

const ADULT_AGE_YEARS = 18;
const BYTES_PER_MEGABYTE = 1_048_576;
const MAX_IMAGE_ATTACHMENT_MEGABYTES = 5;
const MAX_PDF_ATTACHMENT_MEGABYTES = 10;
export const MAX_IMAGE_ATTACHMENT_BYTES = MAX_IMAGE_ATTACHMENT_MEGABYTES * BYTES_PER_MEGABYTE;
export const MAX_PDF_ATTACHMENT_BYTES = MAX_PDF_ATTACHMENT_MEGABYTES * BYTES_PER_MEGABYTE;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_ATTACHMENT_NAME_LENGTH = 120;
export const DEFAULT_MESSAGE_PAGE_SIZE = 50;
export const MAX_MESSAGE_PAGE_SIZE = 100;
export const MAX_CONTACTS = 200;
export const MAX_CONVERSATIONS = 100;

/** Una persona es menor si aún no ha cumplido 18 años; sin fecha de nacimiento se trata como adulta. */
export function isMinor(birthDate: Date | null, now: Date): boolean {
  if (birthDate === null) return false;
  const adultFrom = new Date(birthDate);
  adultFrom.setUTCFullYear(adultFrom.getUTCFullYear() + ADULT_AGE_YEARS);
  return adultFrom.getTime() > now.getTime();
}

export type ChatCounterpart =
  { readonly kind: 'center' } | { readonly kind: 'person'; readonly role: MembershipRoleName };

export interface StartConversationFacts {
  readonly actorRole: MembershipRoleName;
  readonly counterpart: ChatCounterpart;
  readonly isActorMinor: boolean;
  readonly isCounterpartMinor: boolean;
}

export type StartConversationDecision =
  | { readonly kind: 'allowed' }
  | {
      readonly kind: 'denied';
      readonly code: 'CHAT_NOT_ALLOWED' | 'CHAT_MINOR_REQUIRES_GUARDIAN';
    };

const ALLOWED: StartConversationDecision = { kind: 'allowed' };
const NOT_ALLOWED: StartConversationDecision = { kind: 'denied', code: 'CHAT_NOT_ALLOWED' };

function isAdministration(role: MembershipRoleName): boolean {
  return role === 'owner' || role === 'admin';
}

function decideBetweenPeople(
  actorRole: MembershipRoleName,
  counterpartRole: MembershipRoleName,
): StartConversationDecision {
  const isClientWithStaff =
    (actorRole === 'client' && counterpartRole === 'staff') ||
    (actorRole === 'staff' && counterpartRole === 'client');
  return isClientWithStaff ? ALLOWED : NOT_ALLOWED;
}

/** Cuál de las dos partes es un alumno menor; mientras no haya tutores en la app, no se les escribe. */
function involvesMinorClient(facts: StartConversationFacts): boolean {
  const isActorMinorClient = facts.actorRole === 'client' && facts.isActorMinor;
  const isCounterpartMinorClient =
    facts.counterpart.kind === 'person' &&
    facts.counterpart.role === 'client' &&
    facts.isCounterpartMinor;
  return isActorMinorClient || isCounterpartMinorClient;
}

/**
 * Quién puede abrir una conversación con quién:
 * - la administración, con cualquier alumno o profesor (habla en nombre del centro);
 * - un alumno o un profesor, con el centro;
 * - un alumno y un profesor del mismo centro;
 * - nunca alumno con alumno, ni profesor con profesor, ni con menores (solo sus tutores).
 */
export function decideStartConversation(facts: StartConversationFacts): StartConversationDecision {
  if (involvesMinorClient(facts)) {
    return { kind: 'denied', code: 'CHAT_MINOR_REQUIRES_GUARDIAN' };
  }
  const { actorRole, counterpart } = facts;
  if (counterpart.kind === 'center') {
    return isAdministration(actorRole) ? NOT_ALLOWED : ALLOWED;
  }
  if (isAdministration(actorRole)) {
    const isPersonOfTheCenter = counterpart.role === 'client' || counterpart.role === 'staff';
    return isPersonOfTheCenter ? ALLOWED : NOT_ALLOWED;
  }
  return decideBetweenPeople(actorRole, counterpart.role);
}

export type AttachmentDecision =
  | { readonly kind: 'image'; readonly extension: string }
  | { readonly kind: 'pdf'; readonly extension: string }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'too_large' };

/** El tipo del adjunto se lee de sus bytes: ni el nombre ni lo que diga el móvil deciden nada. */
export function decideAttachment(bytes: Buffer): AttachmentDecision {
  const imageFormat = detectPhotoFormat(bytes);
  if (imageFormat !== null) {
    if (bytes.length > MAX_IMAGE_ATTACHMENT_BYTES) return { kind: 'too_large' };
    return { kind: 'image', extension: PHOTO_FILE_EXTENSIONS[imageFormat] };
  }
  if (isPdfFile(bytes)) {
    if (bytes.length > MAX_PDF_ATTACHMENT_BYTES) return { kind: 'too_large' };
    return { kind: 'pdf', extension: 'pdf' };
  }
  return { kind: 'unsupported' };
}

export function buildChatAttachmentKey(request: {
  centerId: string;
  conversationId: string;
  messageId: string;
  extension: string;
}): string {
  const { centerId, conversationId, messageId, extension } = request;
  return `chat/${centerId}/${conversationId}/${messageId}.${extension}`;
}

/** Nombre del fichero tal como lo verá quien lo reciba: sin rutas ni caracteres de control. */
export function sanitizeAttachmentName(rawName: string | undefined, fallback: string): string {
  const baseName = (rawName ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- justamente se quitan los caracteres de control.
  const cleaned = baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned === '' ? fallback : cleaned.slice(0, MAX_ATTACHMENT_NAME_LENGTH);
}
