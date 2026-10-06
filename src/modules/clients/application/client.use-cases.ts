import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  CLIENT_REPOSITORY,
  type ClientListQuery,
  type ClientListResult,
  type ClientPatch,
  type ClientRepository,
  type ClientView,
} from './ports/client.repository';

@Injectable()
export class ListClientsUseCase {
  constructor(@Inject(CLIENT_REPOSITORY) private readonly clients: ClientRepository) {}

  async execute(
    actor: ActorContext,
    query: Omit<ClientListQuery, 'now' | 'staffMembershipId'> & { scope: 'mine' | 'center' },
  ): Promise<ClientListResult> {
    const { scope, ...listQuery } = query;
    return this.clients.listClients(actor, {
      ...listQuery,
      now: new Date(),
      staffMembershipId: actor.role === 'staff' && scope === 'mine' ? actor.membershipId : null,
    });
  }
}

@Injectable()
export class GetClientUseCase {
  constructor(@Inject(CLIENT_REPOSITORY) private readonly clients: ClientRepository) {}

  async execute(actor: ActorContext, membershipId: string): Promise<ClientView> {
    const client = await this.clients.findClient(actor, membershipId, new Date());
    if (!client) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return client;
  }
}

@Injectable()
export class UpdateClientUseCase {
  constructor(@Inject(CLIENT_REPOSITORY) private readonly clients: ClientRepository) {}

  async execute(
    actor: ActorContext,
    membershipId: string,
    patch: ClientPatch,
  ): Promise<ClientView> {
    const outcome = await this.clients.updateClient(actor, {
      membershipId,
      patch,
      now: new Date(),
    });
    if (outcome.kind === 'saved') return outcome.client;
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [
      { path: 'groupId', code: 'unknown_group' },
    ]);
  }
}
