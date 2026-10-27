import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { z } from 'zod';
import { type Prisma } from '../../../generated/prisma/client';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { buildPage, type Page } from '../../../shared/pagination/build-page';
import { decodeCursor } from '../../../shared/pagination/cursor';
import {
  getFirstDayAfterMonth,
  type ChargeStatus,
  type PaymentMethod,
} from '../domain/charge-rules';
import {
  type ChargeCreation,
  type ChargeListQuery,
  type ChargeReportRange,
  type ChargeUpdate,
  type PlatformCharge,
  type PlatformChargeRepository,
} from '../application/ports/platform.repository';

const DAY_LENGTH = 10;

const positionSchema = z.object({ chargedOn: z.iso.date(), id: z.uuid() });

type ChargeRow = Prisma.PlatformChargeGetPayload<{
  include: { center: { select: { name: true } } };
}>;

const WITH_CENTER_NAME = { center: { select: { name: true } } } as const;

function toPlatformCharge(row: ChargeRow): PlatformCharge {
  return {
    id: row.id,
    centerId: row.centerId,
    centerName: row.center.name,
    chargedOn: row.chargedOn.toISOString().slice(0, DAY_LENGTH),
    concept: row.concept,
    baseCents: row.baseCents,
    vatBasisPoints: row.vatBasisPoints,
    vatCents: row.vatCents,
    totalCents: row.totalCents,
    stripeFeeCents: row.stripeFeeCents,
    status: row.status as ChargeStatus,
    source: row.source as PlatformCharge['source'],
    paymentMethod: row.paymentMethod as PaymentMethod,
    invoiceReference: row.invoiceReference,
    stripeId: row.stripeId,
    customerLegalName: row.customerLegalName,
    customerTaxId: row.customerTaxId,
    createdAt: row.createdAt,
  };
}

function toDayRange(fromMonth: string, toMonth: string): Prisma.PlatformChargeWhereInput {
  return {
    chargedOn: {
      gte: new Date(`${fromMonth}-01T00:00:00.000Z`),
      lt: new Date(`${getFirstDayAfterMonth(toMonth)}T00:00:00.000Z`),
    },
  };
}

/** Los cobros anteriores a la posición del cursor, del más reciente al más antiguo. */
function buildOlderThanFilter(cursor: string | undefined): Prisma.PlatformChargeWhereInput {
  if (cursor === undefined) return {};
  const position = decodeCursor(cursor, positionSchema);
  const chargedOn = new Date(`${position.chargedOn}T00:00:00.000Z`);
  return { OR: [{ chargedOn: { lt: chargedOn } }, { chargedOn, id: { lt: position.id } }] };
}

@Injectable()
export class PrismaPlatformChargeRepository implements PlatformChargeRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listCharges(
    actor: PlatformActorContext,
    query: ChargeListQuery,
  ): Promise<Page<PlatformCharge>> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const rows = await client.platformCharge.findMany({
        where: {
          AND: [
            query.month === undefined ? {} : toDayRange(query.month, query.month),
            query.centerId === undefined ? {} : { centerId: query.centerId },
            buildOlderThanFilter(query.cursor),
          ],
        },
        include: WITH_CENTER_NAME,
        orderBy: [{ chargedOn: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      return buildPage({
        fetchedRows: rows.map(toPlatformCharge),
        limit: query.limit,
        toPosition: (last) => ({ chargedOn: last.chargedOn, id: last.id }),
      });
    });
  }

  async findCharge(actor: PlatformActorContext, chargeId: string): Promise<PlatformCharge | null> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const row = await client.platformCharge.findUnique({
        where: { id: chargeId },
        include: WITH_CENTER_NAME,
      });
      return row === null ? null : toPlatformCharge(row);
    });
  }

  async createCharge(creation: ChargeCreation): Promise<PlatformCharge | null> {
    const { actor, charge, auditEntries } = creation;
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const center = await client.center.findUnique({ where: { id: charge.centerId } });
      if (center === null) return null;
      const chargeId = generateUuidV7();
      const created = await client.platformCharge.create({
        data: {
          id: chargeId,
          ...charge,
          chargedOn: new Date(`${charge.chargedOn}T00:00:00.000Z`),
          source: 'manual',
          createdByUserId: actor.userId,
        },
        include: WITH_CENTER_NAME,
      });
      await client.platformAuditEntry.createMany({
        data: auditEntries.map((entry) => ({
          id: generateUuidV7(),
          actorUserId: actor.userId,
          centerId: charge.centerId,
          action: entry.action,
          details: { chargeId, ...entry.details },
        })),
      });
      return toPlatformCharge(created);
    });
  }

  async updateCharge(update: ChargeUpdate): Promise<boolean> {
    const { actor, chargeId, changes, auditEntries } = update;
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const existing = await client.platformCharge.findUnique({ where: { id: chargeId } });
      if (existing === null) return false;
      await client.platformCharge.update({
        where: { id: chargeId },
        data: {
          ...(changes.status === undefined ? {} : { status: changes.status }),
          ...(changes.invoiceReference === undefined
            ? {}
            : { invoiceReference: changes.invoiceReference }),
        },
      });
      await client.platformAuditEntry.createMany({
        data: auditEntries.map((entry) => ({
          id: generateUuidV7(),
          actorUserId: actor.userId,
          centerId: existing.centerId,
          action: entry.action,
          details: entry.details as Prisma.InputJsonObject,
        })),
      });
      return true;
    });
  }

  async listChargesInRange(
    actor: PlatformActorContext,
    range: ChargeReportRange,
  ): Promise<PlatformCharge[]> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const rows = await client.platformCharge.findMany({
        where: toDayRange(range.fromMonth, range.toMonth),
        include: WITH_CENTER_NAME,
        orderBy: [{ chargedOn: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toPlatformCharge);
    });
  }
}
