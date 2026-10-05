import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { buildCenterLogoUrl } from '../../../shared/media/center-logo-url';
import { type LogoUpload, validateLogoUpload } from '../domain/center-logo-image';
import { CENTER_LOGO_REPOSITORY, type CenterLogoRepository } from './ports/center-logo.repository';

export interface UploadCenterLogoRequest {
  readonly ownerUserId: string;
  readonly centerId: string;
  readonly upload: LogoUpload;
}

/**
 * Sube el logo de un centro. Solo su propietario; para cualquier otra persona (admin incluido) o un
 * centro inexistente responde igual, 404, para no revelar qué centros existen.
 */
@Injectable()
export class UploadCenterLogoUseCase {
  constructor(@Inject(CENTER_LOGO_REPOSITORY) private readonly logos: CenterLogoRepository) {}

  async execute(request: UploadCenterLogoRequest): Promise<{ logoUrl: string }> {
    const validation = validateLogoUpload(request.upload);
    if (validation.kind === 'too_large') {
      throw new DomainError('LOGO_TOO_LARGE', HTTP_STATUS.payloadTooLarge);
    }
    if (validation.kind === 'invalid') {
      throw new DomainError('LOGO_INVALID', HTTP_STATUS.unprocessableEntity);
    }

    const uploadedAt = new Date();
    const result = await this.logos.saveForOwner(request.ownerUserId, request.centerId, {
      contentType: validation.contentType,
      bytes: validation.bytes,
      sha256: createHash('sha256').update(validation.bytes).digest('hex'),
      uploadedAt,
    });
    if (result.kind === 'not_owner') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);

    return { logoUrl: buildCenterLogoUrl(request.centerId, uploadedAt) };
  }
}
