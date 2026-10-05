import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  SERVICE_REPOSITORY,
  type NewService,
  type ServicePatch,
  type ServiceRepository,
  type ServiceView,
  type ServiceWriteOutcome,
} from './ports/service.repository';

/** La clientela solo ve lo visible; el equipo ve todo lo que no está archivado. */
@Injectable()
export class ListServicesUseCase {
  constructor(@Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository) {}

  async execute(actor: ActorContext): Promise<ServiceView[]> {
    return this.services.listServices(actor, { onlyVisible: actor.role === 'client' });
  }
}

function unwrapWriteOutcome(outcome: ServiceWriteOutcome): ServiceView {
  if (outcome.kind === 'saved') return outcome.service;
  if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [
    { path: 'staffMembershipIds', code: 'unknown_staff_member' },
  ]);
}

export interface CreateServiceRequest {
  readonly actor: ActorContext;
  readonly service: Omit<NewService, 'staffMembershipIds'> & {
    readonly staffMembershipIds: readonly string[] | undefined;
  };
}

/** Si no se indica quién lo atiende, lo atiende quien lo crea. */
@Injectable()
export class CreateServiceUseCase {
  constructor(@Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository) {}

  async execute({ actor, service }: CreateServiceRequest): Promise<ServiceView> {
    const staffMembershipIds = service.staffMembershipIds ?? [actor.membershipId];
    return unwrapWriteOutcome(
      await this.services.createService(actor, { ...service, staffMembershipIds }),
    );
  }
}

@Injectable()
export class UpdateServiceUseCase {
  constructor(@Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository) {}

  async execute(actor: ActorContext, serviceId: string, patch: ServicePatch): Promise<ServiceView> {
    return unwrapWriteOutcome(await this.services.updateService(actor, serviceId, patch));
  }
}

/** Archivar conserva las reservas existentes; el servicio solo deja de ofrecerse. */
@Injectable()
export class ArchiveServiceUseCase {
  constructor(@Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository) {}

  async execute(actor: ActorContext, serviceId: string): Promise<void> {
    const wasArchived = await this.services.archiveService(actor, serviceId);
    if (!wasArchived) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
