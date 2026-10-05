import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type SchedulingFacts,
  type SchedulingFactsQuery,
  type SchedulingFactsRepository,
} from '../application/ports/scheduling-facts.repository';
import { loadSchedulingFacts } from './scheduling-facts.loader';

@Injectable()
export class PrismaSchedulingFactsRepository implements SchedulingFactsRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findFacts(
    actor: ActorContext,
    query: SchedulingFactsQuery,
  ): Promise<SchedulingFacts | null> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      loadSchedulingFacts(client, query),
    );
  }
}
