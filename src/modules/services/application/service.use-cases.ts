import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { PhotoUrlSigner } from '../../photos/application/photo-url-signer';
import { canClientsSeeProfile } from '../../team-profiles/domain/profile-rules';
import {
  SERVICE_REPOSITORY,
  type NewService,
  type ServicePatch,
  type ServiceRepository,
  type ServiceStaffMember,
  type ServiceView,
  type ServiceWriteOutcome,
} from './ports/service.repository';

export interface SignedServiceStaffMember {
  readonly membershipId: string;
  readonly fullName: string;
  readonly photoUrl: string | null;
  readonly photos: readonly { readonly id: string; readonly url: string }[];
}

export type SignedService = Omit<ServiceView, 'staff'> & {
  readonly staff: readonly SignedServiceStaffMember[];
};

/** Pone los enlaces de foto de quien atiende; a la clientela solo si su perfil profesional está publicado. */
@Injectable()
export class ServicePhotoSigner {
  constructor(private readonly urlSigner: PhotoUrlSigner) {}

  sign(service: ServiceView, actor: ActorContext): SignedService {
    return {
      ...service,
      staff: service.staff.map((member) => this.signStaffMember(member, actor)),
    };
  }

  private signStaffMember(
    member: ServiceStaffMember,
    actor: ActorContext,
  ): SignedServiceStaffMember {
    const { photoKey, profileStatus, galleryPhotos, ...visible } = member;
    const isHiddenFromViewer =
      actor.role === 'client' && !(profileStatus && canClientsSeeProfile(profileStatus));
    return {
      ...visible,
      photoUrl: isHiddenFromViewer ? null : this.urlSigner.sign(photoKey),
      photos: isHiddenFromViewer ? [] : this.urlSigner.signGallery(galleryPhotos),
    };
  }
}

/** La clientela solo ve lo visible; el equipo ve todo lo que no está archivado. */
@Injectable()
export class ListServicesUseCase {
  constructor(
    @Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository,
    private readonly photoSigner: ServicePhotoSigner,
  ) {}

  async execute(actor: ActorContext): Promise<SignedService[]> {
    const services = await this.services.listServices(actor, {
      onlyVisible: actor.role === 'client',
    });
    return services.map((service) => this.photoSigner.sign(service, actor));
  }
}

function unwrapWriteOutcome(outcome: ServiceWriteOutcome): ServiceView {
  if (outcome.kind === 'saved') return outcome.service;
  if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  const invalidField =
    outcome.kind === 'unknown_room'
      ? { path: 'roomId', code: 'unknown_room' }
      : { path: 'staffMembershipIds', code: 'unknown_staff_member' };
  throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [invalidField]);
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
  constructor(
    @Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository,
    private readonly photoSigner: ServicePhotoSigner,
  ) {}

  async execute({ actor, service }: CreateServiceRequest): Promise<SignedService> {
    // Un alquiler se cede sin profesor: no se apunta a quien lo crea.
    const defaultStaff = service.isRental === true ? [] : [actor.membershipId];
    const staffMembershipIds = service.staffMembershipIds ?? defaultStaff;
    const created = unwrapWriteOutcome(
      await this.services.createService(actor, { ...service, staffMembershipIds }),
    );
    return this.photoSigner.sign(created, actor);
  }
}

@Injectable()
export class UpdateServiceUseCase {
  constructor(
    @Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository,
    private readonly photoSigner: ServicePhotoSigner,
  ) {}

  async execute(
    actor: ActorContext,
    serviceId: string,
    patch: ServicePatch,
  ): Promise<SignedService> {
    const updated = unwrapWriteOutcome(await this.services.updateService(actor, serviceId, patch));
    return this.photoSigner.sign(updated, actor);
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
