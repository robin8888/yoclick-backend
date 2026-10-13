import { Inject, Injectable } from '@nestjs/common';
import { PhotoUrlSigner, type WithPhotoUrl } from '../../photos/application/photo-url-signer';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type PassStatusName } from '../domain/pass-rules';
import {
  PASS_REPOSITORY,
  type EligibleClientView,
  type NewRate,
  type PassRepository,
  type PassRequestOutcome,
  type PassView,
  type RatePatch,
  type RateView,
} from './ports/pass.repository';

@Injectable()
export class ListRatesUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(actor: ActorContext): Promise<RateView[]> {
    return this.passes.listRates(actor);
  }
}

@Injectable()
export class CreateRateUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(actor: ActorContext, newRate: NewRate): Promise<RateView> {
    const outcome = await this.passes.createRate(actor, newRate);
    if (outcome.kind === 'saved') return outcome.rate;
    if (outcome.kind === 'limit_reached') {
      throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [
        { path: 'name', code: 'too_many_rates' },
      ]);
    }
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

/** Las condiciones nuevas valen para quien compre después: los bonos ya vendidos no cambian. */
@Injectable()
export class UpdateRateUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(actor: ActorContext, rateId: string, patch: RatePatch): Promise<RateView> {
    const outcome = await this.passes.updateRate(actor, rateId, patch);
    if (outcome.kind === 'saved') return outcome.rate;
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

@Injectable()
export class ArchiveRateUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(actor: ActorContext, rateId: string): Promise<void> {
    const wasArchived = await this.passes.archiveRate(actor, rateId);
    if (!wasArchived) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

function toPassOrThrow(outcome: PassRequestOutcome): PassView {
  if (outcome.kind === 'created') return outcome.pass;
  if (outcome.kind === 'already_pending') {
    throw new DomainError('CONFLICT', HTTP_STATUS.conflict, [
      { path: 'rateId', code: 'pass_already_requested' },
    ]);
  }
  throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
}

@Injectable()
export class RequestPassUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(actor: ActorContext, rateId: string): Promise<PassView> {
    return toPassOrThrow(await this.passes.requestPass(actor, { rateId }));
  }
}

@Injectable()
export class AssignPassUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(
    actor: ActorContext,
    command: { rateId: string; clientMembershipId: string },
  ): Promise<PassView> {
    return toPassOrThrow(await this.passes.assignPass(actor, { ...command, now: new Date() }));
  }
}

@Injectable()
export class ListPassesUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  /** Los de quien pregunta (`mine`) o los del centro, con filtros opcionales. */
  async execute(
    actor: ActorContext,
    query: { clientMembershipId: string | null; statuses: readonly PassStatusName[] | null },
  ): Promise<PassView[]> {
    return this.passes.listPasses(actor, { ...query, now: new Date() });
  }
}

@Injectable()
export class DecidePassUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(
    actor: ActorContext,
    command: { passId: string; decision: 'activate' | 'reject' },
  ): Promise<PassView> {
    const outcome = await this.passes.decidePass(actor, { ...command, now: new Date() });
    if (outcome.kind === 'decided') return outcome.pass;
    if (outcome.kind === 'not_pending') {
      throw new DomainError('CONFLICT', HTTP_STATUS.conflict, [
        { path: 'passId', code: 'pass_not_pending' },
      ]);
    }
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

/** A quién puede apuntar el centro a una clase de ese servicio: personas con bono y clases. */
@Injectable()
export class ListEligibleClientsUseCase {
  constructor(
    @Inject(PASS_REPOSITORY) private readonly passes: PassRepository,
    private readonly urlSigner: PhotoUrlSigner,
  ) {}

  async execute(
    actor: ActorContext,
    serviceId: string,
  ): Promise<WithPhotoUrl<EligibleClientView>[]> {
    const clients = await this.passes.listEligibleClients(actor, { serviceId, now: new Date() });
    return clients.map((client) => this.urlSigner.attachPhotoUrl(client));
  }
}
/** El centro quita un bono que asignó por error o que da de baja. */
@Injectable()
export class CancelPassUseCase {
  constructor(@Inject(PASS_REPOSITORY) private readonly passes: PassRepository) {}

  async execute(actor: ActorContext, passId: string): Promise<void> {
    const wasCancelled = await this.passes.cancelPass(actor, passId);
    if (!wasCancelled) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
