import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NewRate,
  type PassDecisionOutcome,
  type PassListQuery,
  type PassRepository,
  type PassRequestOutcome,
  type PassView,
  type RateChangeOutcome,
  type RatePatch,
  type RateView,
} from '../application/ports/pass.repository';
import { computePassExpiry, MAX_RATES_PER_CENTER, resolvePassStatus } from '../domain/pass-rules';

interface StoredRate {
  readonly id: string;
  readonly name: string;
  readonly sessionsCount: number;
  readonly validDays: number;
  readonly priceCents: number;
  readonly serviceIds: readonly string[];
}

interface StoredPass {
  readonly id: string;
  readonly name: string;
  readonly status: 'pending' | 'active' | 'rejected';
  readonly totalSessions: number;
  readonly remainingSessions: number;
  readonly priceCents: number;
  readonly serviceIds: readonly string[];
  readonly isRequestedByClient: boolean;
  readonly createdAt: Date;
  readonly startsAt: Date | null;
  readonly expiresAt: Date | null;
  readonly clientMembership: { id: string; user: { fullName: string } };
}

const PASS_INCLUDE = {
  clientMembership: { select: { id: true, user: { select: { fullName: true } } } },
} as const;

type ServiceNames = ReadonlyMap<string, string>;

/** Nombres de los servicios mencionados; los archivados siguen contando para bonos ya vendidos. */
async function loadServiceNames(
  client: TenantTransactionClient,
  serviceIds: readonly string[],
): Promise<ServiceNames> {
  if (serviceIds.length === 0) return new Map();
  const services = await client.service.findMany({
    where: { id: { in: [...new Set(serviceIds)] } },
    select: { id: true, name: true },
  });
  return new Map(services.map(({ id, name }) => [id, name]));
}

function toServiceList(serviceIds: readonly string[], names: ServiceNames) {
  return serviceIds.flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [{ id, name }];
  });
}

function toRateView(rate: StoredRate, names: ServiceNames): RateView {
  return {
    id: rate.id,
    name: rate.name,
    sessionsCount: rate.sessionsCount,
    validDays: rate.validDays,
    priceCents: rate.priceCents,
    services: toServiceList(rate.serviceIds, names),
  };
}

function toPassView(pass: StoredPass, input: { names: ServiceNames; now: Date }): PassView {
  return {
    id: pass.id,
    name: pass.name,
    status: resolvePassStatus(pass, input.now),
    totalSessions: pass.totalSessions,
    remainingSessions: pass.remainingSessions,
    priceCents: pass.priceCents,
    services: toServiceList(pass.serviceIds, input.names),
    isRequestedByClient: pass.isRequestedByClient,
    requestedAt: pass.createdAt,
    startsAt: pass.startsAt,
    expiresAt: pass.expiresAt,
    client: {
      membershipId: pass.clientMembership.id,
      fullName: pass.clientMembership.user.fullName,
    },
  };
}

async function areServicesInCenter(
  client: TenantTransactionClient,
  serviceIds: readonly string[],
): Promise<boolean> {
  if (serviceIds.length === 0) return true;
  const count = await client.service.count({
    where: { id: { in: [...serviceIds] }, archivedAt: null },
  });
  return count === new Set(serviceIds).size;
}

async function viewRate(client: TenantTransactionClient, rate: StoredRate): Promise<RateView> {
  return toRateView(rate, await loadServiceNames(client, rate.serviceIds));
}

async function viewPass(
  client: TenantTransactionClient,
  input: { pass: StoredPass; now: Date },
): Promise<PassView> {
  const names = await loadServiceNames(client, input.pass.serviceIds);
  return toPassView(input.pass, { names, now: input.now });
}

async function notifyAdministrators(
  client: TenantTransactionClient,
  input: { centerId: string; clientMembershipId: string; rateName: string },
): Promise<void> {
  const recipients = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  const person = await client.membership.findUnique({
    where: { id: input.clientMembershipId },
    select: { user: { select: { fullName: true } } },
  });
  await client.notification.createMany({
    data: recipients.map(({ id }) => ({
      id: generateUuidV7(),
      centerId: input.centerId,
      recipientMembershipId: id,
      kind: 'pass_requested' as const,
      data: { clientName: person?.user.fullName ?? '', rateName: input.rateName },
    })),
  });
}

async function notifyClientPassActive(
  client: TenantTransactionClient,
  input: { centerId: string; clientMembershipId: string; rateName: string },
): Promise<void> {
  await client.notification.create({
    data: {
      id: generateUuidV7(),
      centerId: input.centerId,
      recipientMembershipId: input.clientMembershipId,
      kind: 'pass_activated',
      data: { rateName: input.rateName },
    },
  });
}

@Injectable()
export class PrismaPassRepository implements PassRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listRates(actor: ActorContext): Promise<RateView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const rates = await client.rate.findMany({
        where: { archivedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const names = await loadServiceNames(
        client,
        rates.flatMap(({ serviceIds }) => serviceIds),
      );
      return rates.map((rate) => toRateView(rate, names));
    });
  }

  async createRate(actor: ActorContext, newRate: NewRate): Promise<RateChangeOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if ((await client.rate.count({ where: { archivedAt: null } })) >= MAX_RATES_PER_CENTER) {
        return { kind: 'limit_reached' };
      }
      if (!(await areServicesInCenter(client, newRate.serviceIds))) {
        return { kind: 'service_not_found' };
      }
      const rate = await client.rate.create({
        data: {
          id: generateUuidV7(),
          centerId: actor.centerId,
          name: newRate.name,
          sessionsCount: newRate.sessionsCount,
          validDays: newRate.validDays,
          priceCents: newRate.priceCents,
          serviceIds: [...newRate.serviceIds],
        },
      });
      return { kind: 'saved', rate: await viewRate(client, rate) };
    });
  }

  async updateRate(
    actor: ActorContext,
    rateId: string,
    patch: RatePatch,
  ): Promise<RateChangeOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const current = await client.rate.findFirst({ where: { id: rateId, archivedAt: null } });
      if (!current) return { kind: 'not_found' };
      if (!(await areServicesInCenter(client, patch.serviceIds ?? []))) {
        return { kind: 'service_not_found' };
      }
      // Los bonos ya vendidos guardan su propia copia: cambiar la tarifa no los toca.
      const rate = await client.rate.update({
        where: { id: rateId },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.sessionsCount !== undefined && { sessionsCount: patch.sessionsCount }),
          ...(patch.validDays !== undefined && { validDays: patch.validDays }),
          ...(patch.priceCents !== undefined && { priceCents: patch.priceCents }),
          ...(patch.serviceIds !== undefined && { serviceIds: [...patch.serviceIds] }),
        },
      });
      return { kind: 'saved', rate: await viewRate(client, rate) };
    });
  }

  async archiveRate(actor: ActorContext, rateId: string): Promise<boolean> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const archived = await client.rate.updateMany({
        where: { id: rateId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      return archived.count === 1;
    });
  }

  async requestPass(actor: ActorContext, command: { rateId: string }): Promise<PassRequestOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const rate = await client.rate.findFirst({ where: { id: command.rateId, archivedAt: null } });
      if (!rate) return { kind: 'rate_not_found' };
      const pending = await client.clientPass.count({
        where: {
          clientMembershipId: actor.membershipId,
          rateId: rate.id,
          status: 'pending',
        },
      });
      if (pending > 0) return { kind: 'already_pending' };
      const pass = await client.clientPass.create({
        data: {
          id: generateUuidV7(),
          centerId: actor.centerId,
          clientMembershipId: actor.membershipId,
          rateId: rate.id,
          name: rate.name,
          totalSessions: rate.sessionsCount,
          remainingSessions: rate.sessionsCount,
          priceCents: rate.priceCents,
          serviceIds: rate.serviceIds,
          status: 'pending',
          isRequestedByClient: true,
        },
        include: PASS_INCLUDE,
      });
      await notifyAdministrators(client, {
        centerId: actor.centerId,
        clientMembershipId: actor.membershipId,
        rateName: rate.name,
      });
      return { kind: 'created', pass: await viewPass(client, { pass, now: new Date() }) };
    });
  }

  async assignPass(
    actor: ActorContext,
    command: { rateId: string; clientMembershipId: string; now: Date },
  ): Promise<PassRequestOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const rate = await client.rate.findFirst({ where: { id: command.rateId, archivedAt: null } });
      if (!rate) return { kind: 'rate_not_found' };
      const person = await client.membership.count({
        where: { id: command.clientMembershipId, role: 'client', status: 'active' },
      });
      if (person === 0) return { kind: 'client_not_found' };
      const pass = await client.clientPass.create({
        data: {
          id: generateUuidV7(),
          centerId: actor.centerId,
          clientMembershipId: command.clientMembershipId,
          rateId: rate.id,
          name: rate.name,
          totalSessions: rate.sessionsCount,
          remainingSessions: rate.sessionsCount,
          priceCents: rate.priceCents,
          serviceIds: rate.serviceIds,
          status: 'active',
          isRequestedByClient: false,
          startsAt: command.now,
          expiresAt: computePassExpiry(command.now, rate.validDays),
          decidedByMembershipId: actor.membershipId,
          decidedAt: command.now,
        },
        include: PASS_INCLUDE,
      });
      await notifyClientPassActive(client, {
        centerId: actor.centerId,
        clientMembershipId: command.clientMembershipId,
        rateName: rate.name,
      });
      return { kind: 'created', pass: await viewPass(client, { pass, now: command.now }) };
    });
  }

  async listPasses(actor: ActorContext, query: PassListQuery): Promise<PassView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const passes = await client.clientPass.findMany({
        where: {
          ...(query.clientMembershipId !== null && {
            clientMembershipId: query.clientMembershipId,
          }),
        },
        include: PASS_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      const names = await loadServiceNames(
        client,
        passes.flatMap(({ serviceIds }) => serviceIds),
      );
      const views = passes.map((pass) => toPassView(pass, { names, now: query.now }));
      const { statuses } = query;
      return statuses === null ? views : views.filter(({ status }) => statuses.includes(status));
    });
  }

  async decidePass(
    actor: ActorContext,
    command: { passId: string; decision: 'activate' | 'reject'; now: Date },
  ): Promise<PassDecisionOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const current = await client.clientPass.findUnique({ where: { id: command.passId } });
      if (!current) return { kind: 'not_found' };
      const rate = await client.rate.findUniqueOrThrow({ where: { id: current.rateId } });
      const isActivating = command.decision === 'activate';
      // UPDATE condicionado a «sigue pendiente»: dos decisiones a la vez no se pisan.
      const decided = await client.clientPass.updateMany({
        where: { id: command.passId, status: 'pending' },
        data: {
          status: isActivating ? 'active' : 'rejected',
          decidedByMembershipId: actor.membershipId,
          decidedAt: command.now,
          ...(isActivating && {
            startsAt: command.now,
            expiresAt: computePassExpiry(command.now, rate.validDays),
          }),
        },
      });
      if (decided.count === 0) return { kind: 'not_pending' };
      const pass = await client.clientPass.findUniqueOrThrow({
        where: { id: command.passId },
        include: PASS_INCLUDE,
      });
      if (isActivating) {
        await notifyClientPassActive(client, {
          centerId: actor.centerId,
          clientMembershipId: pass.clientMembershipId,
          rateName: pass.name,
        });
      }
      return { kind: 'decided', pass: await viewPass(client, { pass, now: command.now }) };
    });
  }
}
