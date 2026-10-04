import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';

export interface CenterBranding {
  readonly centerId: string;
  readonly name: string;
  readonly sectorId: string;
  readonly brandColor: string;
}

export interface CenterBrandingRepository {
  findBranding(centerId: string): Promise<CenterBranding | null>;
}

export const CENTER_BRANDING_REPOSITORY = Symbol('CENTER_BRANDING_REPOSITORY');

/** La marca de un centro es pública (la app la pinta antes de iniciar sesión) y cacheable. */
@Injectable()
export class GetCenterBrandingUseCase {
  constructor(
    @Inject(CENTER_BRANDING_REPOSITORY) private readonly branding: CenterBrandingRepository,
  ) {}

  async execute(centerId: string): Promise<CenterBranding> {
    const centerBranding = await this.branding.findBranding(centerId);
    if (!centerBranding) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return centerBranding;
  }
}
