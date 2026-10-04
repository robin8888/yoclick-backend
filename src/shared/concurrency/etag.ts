import { createHash } from 'node:crypto';
import { DomainError } from '../errors/domain-error';
import { HTTP_STATUS } from '../errors/http-status';

const ETAG_LENGTH = 22;
const WILDCARD_ETAG = '*';

interface VersionedResource {
  readonly id: string;
  readonly updatedAt: Date;
}

/**
 * Validador débil derivado del id y de `updatedAt`. Es un identificador de versión, no un secreto:
 * el hash solo evita exponer la marca de tiempo tal cual.
 */
export function buildEtag(resource: VersionedResource): string {
  const fingerprint = createHash('sha256')
    .update(`${resource.id}:${resource.updatedAt.toISOString()}`)
    .digest('base64url')
    .slice(0, ETAG_LENGTH);
  return `W/"${fingerprint}"`;
}

/**
 * Concurrencia optimista: editar el centro, un servicio o un perfil exige `If-Match` con la
 * versión que la persona vio. Si otra persona lo cambió entretanto, se responde 412 en lugar de
 * pisar su cambio.
 */
export function assertIfMatchPrecondition(
  ifMatchHeader: string | undefined,
  currentEtag: string,
): void {
  if (ifMatchHeader === undefined || ifMatchHeader.trim() === '') {
    throw new DomainError('PRECONDITION_REQUIRED', HTTP_STATUS.preconditionRequired);
  }

  const acceptedEtags = ifMatchHeader.split(',').map((etag) => etag.trim());
  const isCurrentVersionAccepted =
    acceptedEtags.includes(WILDCARD_ETAG) || acceptedEtags.includes(currentEtag);
  if (!isCurrentVersionAccepted)
    throw new DomainError('PRECONDITION_FAILED', HTTP_STATUS.preconditionFailed);
}
