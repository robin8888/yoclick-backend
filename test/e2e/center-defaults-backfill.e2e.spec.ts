import { Test } from '@nestjs/testing';
import { CenterDefaultsBackfiller } from '../../src/seed/center-defaults-backfiller';
import { DemoSeeder } from '../../src/seed/demo-seeder';
import { SeedModule } from '../../src/seed/seed.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';

describe('default hours and services for existing centers', () => {
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  let fixtures: DatabaseFixtures;
  let backfiller: CenterDefaultsBackfiller;
  let demoSeeder: DemoSeeder;

  async function readCenter(centerId: string, userId: string, membershipId: string) {
    return tenantPrismaService.runInTenantContext(
      { userId, centerId, membershipId, role: 'owner', permissions: [] },
      async (client) => ({
        center: await client.center.findUniqueOrThrow({ where: { id: centerId } }),
        services: await client.service.findMany({
          include: { staff: true },
          orderBy: { sortOrder: 'asc' },
        }),
      }),
    );
  }

  async function createLegacyCenter(slug: string, joinCode: string) {
    const ownerUserId = await fixtures.createUser(`owner-${slug}`);
    const centerId = await fixtures.createCenter(slug, joinCode);
    const membershipId = await fixtures.createMembership({
      centerId,
      userId: ownerUserId,
      role: 'owner',
    });
    return { ownerUserId, centerId, membershipId };
  }

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [SeedModule] }).compile();
    await testingModule.init();
    prismaService = testingModule.get(PrismaService);
    tenantPrismaService = testingModule.get(TenantPrismaService);
    fixtures = new DatabaseFixtures(prismaService, tenantPrismaService);
    backfiller = testingModule.get(CenterDefaultsBackfiller);
    demoSeeder = testingModule.get(DemoSeeder);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });

  it('gives a center created before services existed its hours and its sector services, run by its owner', async () => {
    const legacy = await createLegacyCenter('legacy-gym', 'LEGAC1');

    const summary = await backfiller.run();

    expect(summary).toMatchObject({
      centerCount: 1,
      centersWithNewServices: 1,
      centersWithNewOpeningHours: 1,
      createdServiceCount: 4,
    });
    const { center, services } = await readCenter(
      legacy.centerId,
      legacy.ownerUserId,
      legacy.membershipId,
    );
    expect(center.openingHours).toMatchObject({
      mon: [
        { opensAt: '09:00', closesAt: '14:00' },
        { opensAt: '16:00', closesAt: '20:00' },
      ],
    });
    expect(services.map(({ name }) => name)).toEqual([
      'Entrenamiento personal',
      'Clase dirigida',
      'Valoración inicial',
      'Grupo reducido',
    ]);
    for (const service of services) {
      expect(service.kind).toBe('individual');
      expect(service.staff.map(({ membershipId }) => membershipId)).toEqual([legacy.membershipId]);
    }
  });

  it('is idempotent: running it again changes nothing', async () => {
    const legacy = await createLegacyCenter('legacy-gym', 'LEGAC1');
    await backfiller.run();

    const second = await backfiller.run();

    expect(second).toMatchObject({
      centersWithNewServices: 0,
      centersWithNewOpeningHours: 0,
      createdServiceCount: 0,
    });
    const { services } = await readCenter(legacy.centerId, legacy.ownerUserId, legacy.membershipId);
    expect(services).toHaveLength(4);
  });

  it('respects a center that already has its own hours and services, even archived ones', async () => {
    const legacy = await createLegacyCenter('legacy-gym', 'LEGAC1');
    await tenantPrismaService.runInTenantContext(
      {
        userId: legacy.ownerUserId,
        centerId: legacy.centerId,
        membershipId: legacy.membershipId,
        role: 'owner',
        permissions: [],
      },
      async (client) => {
        await client.center.update({
          where: { id: legacy.centerId },
          data: { openingHours: { mon: [{ opensAt: '10:00', closesAt: '12:00' }] } },
        });
        await client.service.create({
          data: {
            id: '0192f3b4-0000-7000-8000-000000000001',
            centerId: legacy.centerId,
            name: 'Solo esto',
            durationMinutes: 30,
            archivedAt: new Date(),
          },
        });
      },
    );

    const summary = await backfiller.run();

    expect(summary).toMatchObject({ createdServiceCount: 0, centersWithNewOpeningHours: 0 });
    const { center, services } = await readCenter(
      legacy.centerId,
      legacy.ownerUserId,
      legacy.membershipId,
    );
    expect(center.openingHours).toEqual({ mon: [{ opensAt: '10:00', closesAt: '12:00' }] });
    expect(services.map(({ name }) => name)).toEqual(['Solo esto']);
  });

  it('seeds the four demo centers with hours, services and professionals, and does not duplicate them', async () => {
    await demoSeeder.run();
    await demoSeeder.run();

    const serviceCounts = await prismaService.user
      .findMany({ where: { email: { startsWith: 'yoclick.owner.' } }, select: { id: true } })
      .then((owners) =>
        Promise.all(
          owners.map(async ({ id }) => {
            const [membership] = await tenantPrismaService.runInUserContext(id, (client) =>
              client.membership.findMany({ where: { userId: id, role: 'owner' } }),
            );
            const centerId = membership?.centerId ?? '';
            return tenantPrismaService.runInTenantContext(
              {
                userId: id,
                centerId,
                membershipId: membership?.id ?? '',
                role: 'owner',
                permissions: [],
              },
              async (client) => ({
                services: await client.service.count(),
                professionalsPerService: (
                  await client.serviceStaff.findMany({ select: { membershipId: true } })
                ).length,
                hasHours: (await client.center.findUniqueOrThrow({ where: { id: centerId } }))
                  .openingHours,
              }),
            );
          }),
        ),
      );

    expect(serviceCounts).toHaveLength(4);
    for (const counts of serviceCounts) {
      expect(counts.services).toBe(4);
      // El propietario y el personal atienden cada servicio.
      expect(counts.professionalsPerService).toBe(8);
      expect(counts.hasHours).not.toBeNull();
    }
  });
});
