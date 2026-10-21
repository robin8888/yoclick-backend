import { Inject, Injectable } from '@nestjs/common';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type Page } from '../../../shared/pagination/build-page';
import { describeCenterChanges, isValidTrialEnd } from '../domain/center-changes';
import {
  PLATFORM_REPOSITORY,
  type AuditListQuery,
  type CenterChanges,
  type CenterListQuery,
  type PlatformAuditEntry,
  type PlatformCenterDetail,
  type PlatformCenterSummary,
  type PlatformOverview,
  type PlatformRepository,
} from './ports/platform.repository';

@Injectable()
export class GetPlatformOverviewUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  execute(actor: PlatformActorContext): Promise<PlatformOverview> {
    return this.platform.getOverview(actor, new Date());
  }
}

@Injectable()
export class ListPlatformCentersUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  execute(
    actor: PlatformActorContext,
    query: CenterListQuery,
  ): Promise<Page<PlatformCenterSummary>> {
    return this.platform.listCenters(actor, query, new Date());
  }
}

@Injectable()
export class GetPlatformCenterUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  async execute(actor: PlatformActorContext, centerId: string): Promise<PlatformCenterDetail> {
    const center = await this.platform.findCenter(actor, centerId, new Date());
    if (center === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return center;
  }
}

/** Cambia el estado, el fin de la prueba o el tope de clientes de un centro y lo deja en la auditoría. */
@Injectable()
export class UpdatePlatformCenterUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  async execute(
    actor: PlatformActorContext,
    centerId: string,
    changes: CenterChanges,
  ): Promise<PlatformCenterDetail> {
    const now = new Date();
    if (changes.trialEndsAt !== undefined && !isValidTrialEnd(changes.trialEndsAt, now)) {
      throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    }
    const current = await this.platform.findCenter(actor, centerId, now);
    if (current === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);

    const auditEntries = describeCenterChanges(current, changes);
    if (auditEntries.length > 0) {
      const wasUpdated = await this.platform.updateCenter({
        actor,
        centerId,
        changes,
        auditEntries,
      });
      if (!wasUpdated) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    const updated = await this.platform.findCenter(actor, centerId, now);
    if (updated === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return updated;
  }
}

@Injectable()
export class ListPlatformAuditUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  execute(actor: PlatformActorContext, query: AuditListQuery): Promise<Page<PlatformAuditEntry>> {
    return this.platform.listAuditEntries(actor, query);
  }
}
