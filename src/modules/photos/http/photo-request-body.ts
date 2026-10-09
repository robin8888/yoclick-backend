import { type FastifyRequest } from 'fastify';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';

/** El cuerpo de una subida de foto es la imagen entera, como bytes; cualquier otra cosa no lo es. */
export function readPhotoBytes(request: FastifyRequest): Buffer {
  if (!Buffer.isBuffer(request.body)) {
    throw new DomainError('PHOTO_NOT_IMAGE', HTTP_STATUS.badRequest);
  }
  return request.body;
}
