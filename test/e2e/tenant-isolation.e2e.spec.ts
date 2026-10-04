import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { v7 as generateUuidV7 } from 'uuid';
import { parseEnvironment } from '../../src/shared/config/parse-environment';
import { DatabaseModule } from '../../src/shared/database/database.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { type ActorContext } from '../../src/shared/tenancy/actor-context';
import { resetTestDatabase } from '../support/test-database';

interface Fixture {
  centerAId: string;
  centerBId: string;
  anaUserId: string;
  beaUserId: string;
  carlosUserId: string;
}

const CONCURRENT_REQUEST_COUNT = 40;
const SLOW_QUERY_TEST_TIMEOUT_MS = 15_000;

function buildActor(centerId: string, userId: string, role: ActorContext['role']): ActorContext {
  return { userId, centerId, membershipId: generateUuidV7(), role, permissions: [] };
}

describe('tenant isolation with Row Level Security', () => {
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  let fixture: Fixture;

  async function createCenter(centerId: string, slug: string, joinCode: string): Promise<void> {
    const actor = buildActor(centerId, generateUuidV7(), 'owner');
    await tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.create({
        data: { id: centerId, slug, name: slug, sectorId: 'gym', brandColor: '#E4572E', joinCode },
      }),
    );
  }

  async function createUser(emailPrefix: string): Promise<string> {
    const userId = generateUuidV7();
    await prismaService.user.create({
      data: {
        id: userId,
        email: `${emailPrefix}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: emailPrefix,
      },
    });
    return userId;
  }

  async function createMembership(centerId: string, userId: string): Promise<void> {
    await tenantPrismaService.runInTenantContext(buildActor(centerId, userId, 'client'), (client) =>
      client.membership.create({
        data: { id: generateUuidV7(), centerId, userId, role: 'client' },
      }),
    );
  }

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: parseEnvironment }),
        DatabaseModule,
      ],
    }).compile();
    await testingModule.init();
    prismaService = testingModule.get(PrismaService);
    tenantPrismaService = testingModule.get(TenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    fixture = {
      centerAId: generateUuidV7(),
      centerBId: generateUuidV7(),
      anaUserId: await createUser('ana'),
      beaUserId: await createUser('bea'),
      carlosUserId: await createUser('carlos'),
    };
    await createCenter(fixture.centerAId, 'center-a', 'AAAAAA');
    await createCenter(fixture.centerBId, 'center-b', 'BBBBBB');
    await createMembership(fixture.centerAId, fixture.anaUserId);
    await createMembership(fixture.centerBId, fixture.beaUserId);
    await createMembership(fixture.centerAId, fixture.carlosUserId);
    await createMembership(fixture.centerBId, fixture.carlosUserId);
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });

  it('shows a center only its own memberships', async () => {
    const actorOfCenterA = buildActor(fixture.centerAId, fixture.anaUserId, 'admin');

    const visibleMemberships = await tenantPrismaService.runInTenantContext(
      actorOfCenterA,
      (client) => client.membership.findMany(),
    );

    expect(visibleMemberships).toHaveLength(2);
    expect(
      visibleMemberships.every((membership) => membership.centerId === fixture.centerAId),
    ).toBe(true);
  });

  it('shows a center only itself in the centers table', async () => {
    const actorOfCenterB = buildActor(fixture.centerBId, fixture.beaUserId, 'admin');

    const visibleCenters = await tenantPrismaService.runInTenantContext(actorOfCenterB, (client) =>
      client.center.findMany(),
    );

    expect(visibleCenters.map((center) => center.id)).toEqual([fixture.centerBId]);
  });

  it('cannot read a membership of another center even knowing its exact id', async () => {
    const membershipOfCenterB = await tenantPrismaService.runInTenantContext(
      buildActor(fixture.centerBId, fixture.beaUserId, 'admin'),
      (client) => client.membership.findFirstOrThrow(),
    );

    const lookupFromCenterA = await tenantPrismaService.runInTenantContext(
      buildActor(fixture.centerAId, fixture.anaUserId, 'admin'),
      (client) => client.membership.findUnique({ where: { id: membershipOfCenterB.id } }),
    );

    expect(lookupFromCenterA).toBeNull();
  });

  it('refuses to insert a membership into another center (WITH CHECK)', async () => {
    const actorOfCenterA = buildActor(fixture.centerAId, fixture.anaUserId, 'admin');

    const insertIntoCenterB = tenantPrismaService.runInTenantContext(actorOfCenterA, (client) =>
      client.membership.create({
        data: {
          id: generateUuidV7(),
          centerId: fixture.centerBId,
          userId: fixture.anaUserId,
          role: 'client',
        },
      }),
    );

    await expect(insertIntoCenterB).rejects.toThrow();
  });

  it('updates and deletes nothing in another center', async () => {
    const actorOfCenterA = buildActor(fixture.centerAId, fixture.anaUserId, 'admin');

    const outcome = await tenantPrismaService.runInTenantContext(
      actorOfCenterA,
      async (client) => ({
        updated: await client.membership.updateMany({
          where: { centerId: fixture.centerBId },
          data: { role: 'admin' },
        }),
        deleted: await client.membership.deleteMany({ where: { centerId: fixture.centerBId } }),
      }),
    );

    expect(outcome.updated.count).toBe(0);
    expect(outcome.deleted.count).toBe(0);
  });

  it('sees nothing when there is no tenant context at all (deny by default)', async () => {
    const memberships = await prismaService.membership.findMany();
    const centers = await prismaService.center.findMany();

    expect(memberships).toEqual([]);
    expect(centers).toEqual([]);
  });

  it('still sees nothing after a pooled connection was used inside a tenant context', async () => {
    const actorOfCenterA = buildActor(fixture.centerAId, fixture.anaUserId, 'admin');
    await tenantPrismaService.runInTenantContext(actorOfCenterA, (client) =>
      client.membership.findMany(),
    );

    const afterwards = await prismaService.membership.findMany();

    expect(afterwards).toEqual([]);
  });

  it('lets a person read their own memberships across every center, and only those', async () => {
    const carlosMemberships = await tenantPrismaService.runInUserContext(
      fixture.carlosUserId,
      (client) => client.membership.findMany(),
    );

    const visibleCenterIds = carlosMemberships.map((membership) => membership.centerId);
    expect(visibleCenterIds).toHaveLength(2);
    expect(visibleCenterIds).toEqual(
      expect.arrayContaining([fixture.centerAId, fixture.centerBId]),
    );
    expect(
      carlosMemberships.every((membership) => membership.userId === fixture.carlosUserId),
    ).toBe(true);
  });

  it('lets a person see the centers they belong to, but not others', async () => {
    const beaCenters = await tenantPrismaService.runInUserContext(fixture.beaUserId, (client) =>
      client.center.findMany(),
    );

    expect(beaCenters.map((center) => center.id)).toEqual([fixture.centerBId]);
  });

  it('does not leak tenant context between concurrent requests sharing the pool', async () => {
    const requests = Array.from({ length: CONCURRENT_REQUEST_COUNT }, (_, index) => {
      const centerId = index % 2 === 0 ? fixture.centerAId : fixture.centerBId;
      const actor = buildActor(centerId, fixture.carlosUserId, 'admin');
      return tenantPrismaService
        .runInTenantContext(actor, (client) => client.membership.findMany())
        .then((memberships) => ({ centerId, memberships }));
    });

    const results = await Promise.all(requests);

    for (const { centerId, memberships } of results) {
      expect(memberships.every((membership) => membership.centerId === centerId)).toBe(true);
    }
  });

  it(
    'applies a statement timeout inside the transaction (SEC-52)',
    async () => {
      const actorOfCenterA = buildActor(fixture.centerAId, fixture.anaUserId, 'admin');

      const slowQuery = tenantPrismaService.runInTenantContext(
        actorOfCenterA,
        (client) => client.$queryRaw`select pg_sleep(10)`,
      );

      await expect(slowQuery).rejects.toThrow();
    },
    SLOW_QUERY_TEST_TIMEOUT_MS,
  );

  it('runs the API with a role that cannot bypass RLS nor change the schema (SEC-63)', async () => {
    const [role] = await prismaService.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean }[]
    >`select rolsuper, rolbypassrls, rolcreatedb from pg_roles where rolname = current_user`;

    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false });
    await expect(prismaService.$executeRaw`create table _probe (id int)`).rejects.toThrow();
  });
});
