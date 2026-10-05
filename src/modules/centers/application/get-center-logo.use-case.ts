import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import {
  CENTER_LOGO_READER,
  type CenterLogoReader,
  type StoredCenterLogo,
} from './ports/center-logo-reader.repository';

/** El logo es público (la app lo pinta antes de iniciar sesión): quien lo pide no necesita sesión. */
@Injectable()
export class GetCenterLogoUseCase {
  constructor(@Inject(CENTER_LOGO_READER) private readonly logos: CenterLogoReader) {}

  async execute(centerId: string): Promise<StoredCenterLogo> {
    const logo = await this.logos.findPublicLogo(centerId);
    if (!logo) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return logo;
  }
}
