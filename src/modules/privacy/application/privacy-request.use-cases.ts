import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { ReauthenticationChecker } from '../../auth/application/reauthentication.checker';
import {
  calculatePrivacyRequestDueDate,
  type PrivacyRequestKindName,
  type PrivacyRequestOutcome,
} from '../domain/privacy-request-rules';
import {
  PRIVACY_REQUEST_REPOSITORY,
  type ClientDataExport,
  type PrivacyRequestRepository,
  type PrivacyRequestView,
} from './ports/privacy-request.repository';

@Injectable()
export class CreatePrivacyRequestUseCase {
  constructor(
    @Inject(PRIVACY_REQUEST_REPOSITORY) private readonly requests: PrivacyRequestRepository,
  ) {}

  async execute(request: {
    actor: ActorContext;
    kind: PrivacyRequestKindName;
    message: string | null;
  }): Promise<PrivacyRequestView> {
    const outcome = await this.requests.create(request.actor, {
      id: generateUuidV7(),
      kind: request.kind,
      message: request.message,
      dueAt: calculatePrivacyRequestDueDate(new Date()),
    });
    if (outcome.kind === 'already_open') {
      throw new DomainError('PRIVACY_REQUEST_ALREADY_OPEN', HTTP_STATUS.conflict);
    }
    return outcome.request;
  }
}

@Injectable()
export class ListPrivacyRequestsUseCase {
  constructor(
    @Inject(PRIVACY_REQUEST_REPOSITORY) private readonly requests: PrivacyRequestRepository,
  ) {}

  /** La clientela ve las suyas; la administración, las de todo el centro. */
  async execute(actor: ActorContext, scope: 'mine' | 'center'): Promise<PrivacyRequestView[]> {
    return scope === 'mine' ? this.requests.listMine(actor) : this.requests.listForCenter(actor);
  }
}

@Injectable()
export class ResolvePrivacyRequestUseCase {
  constructor(
    @Inject(PRIVACY_REQUEST_REPOSITORY) private readonly requests: PrivacyRequestRepository,
  ) {}

  async execute(request: {
    actor: ActorContext;
    requestId: string;
    outcome: PrivacyRequestOutcome;
    note: string | null;
  }): Promise<PrivacyRequestView> {
    const outcome = await this.requests.resolve(request.actor, request);
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'already_resolved') {
      throw new DomainError('PRIVACY_REQUEST_CLOSED', HTTP_STATUS.conflict);
    }
    return outcome.request;
  }
}

@Injectable()
export class ExportClientDataUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    @Inject(PRIVACY_REQUEST_REPOSITORY) private readonly requests: PrivacyRequestRepository,
  ) {}

  /** Responder a un derecho de acceso: pide la contraseña de quien exporta, porque se lleva datos personales ajenos. */
  async execute(request: {
    actor: ActorContext;
    clientMembershipId: string;
    password: string;
  }): Promise<ClientDataExport> {
    await this.reauthenticationChecker.assertPasswordIsCorrect(
      request.actor.userId,
      request.password,
    );
    const exported = await this.requests.exportClientData(
      request.actor,
      request.clientMembershipId,
    );
    if (!exported) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return exported;
  }
}
