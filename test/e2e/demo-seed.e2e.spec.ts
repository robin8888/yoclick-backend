import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DEMO_EMAIL_DOMAIN, DEMO_PASSWORD } from '../../src/seed/demo-data';
import { DemoSeeder } from '../../src/seed/demo-seeder';
import { SeedModule } from '../../src/seed/seed.module';
import { PasswordHasher } from '../../src/shared/auth/password-hasher';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { ActiveMembershipFinder } from '../../src/shared/tenancy/active-membership.finder';
import { resetTestDatabase } from '../support/test-database';

const EXPECTED_CENTER_COUNT = 4;
const EXPECTED_USER_COUNT = 21;
const EXPECTED_MEMBERSHIP_COUNT = 24;

describe('demo seed', () => {
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  let demoSeeder: DemoSeeder;
  let passwordHasher: PasswordHasher;

  async function countRows(): Promise<{ users: number; centers: number; memberships: number }> {
    const users = await prismaService.user.count();
    // centers y memberships tienen RLS: sin contexto no se ven, así que se miran como cada persona.
    const accounts = await prismaService.user.findMany({ select: { id: true } });
    const distinctCenterIds = new Set<string>();
    let memberships = 0;
    for (const { id } of accounts) {
      const own = await tenantPrismaService.runInUserContext(id, async (client) => ({
        membershipCount: await client.membership.count(),
        centers: await client.center.findMany({ select: { id: true } }),
      }));
      memberships += own.membershipCount;
      own.centers.forEach((center) => distinctCenterIds.add(center.id));
    }
    return { users, centers: distinctCenterIds.size, memberships };
  }

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [SeedModule] }).compile();
    await testingModule.init();
    prismaService = testingModule.get(PrismaService);
    tenantPrismaService = testingModule.get(TenantPrismaService);
    demoSeeder = testingModule.get(DemoSeeder);
    passwordHasher = testingModule.get(PasswordHasher);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });

  it('reports what it created: four centers, 21 people and their memberships', async () => {
    const summary = await demoSeeder.run();

    expect(summary).toEqual({
      centerCount: EXPECTED_CENTER_COUNT,
      userCount: EXPECTED_USER_COUNT,
      membershipCount: EXPECTED_MEMBERSHIP_COUNT,
    });
  });

  it('creates the four demo centers with their join codes and brand colors', async () => {
    await demoSeeder.run();

    const multiCenterUser = await prismaService.user.findUniqueOrThrow({
      where: { email: `multi@${DEMO_EMAIL_DOMAIN}` },
    });
    const centers = await tenantPrismaService.runInUserContext(multiCenterUser.id, (client) =>
      client.center.findMany({ orderBy: { joinCode: 'asc' } }),
    );

    expect(
      centers.map(({ joinCode, brandColor, sectorId }) => ({ joinCode, brandColor, sectorId })),
    ).toEqual([
      { joinCode: 'COMPAS', brandColor: '#7A3FE0', sectorId: 'baile' },
      { joinCode: 'FORJA2', brandColor: '#2446C7', sectorId: 'readap' },
      { joinCode: 'KINE24', brandColor: '#C8F031', sectorId: 'box' },
      { joinCode: 'NORTE7', brandColor: '#E4572E', sectorId: 'estudio' },
    ]);
  });

  it('gives every demo person the shared test password, hashed with argon2id', async () => {
    await demoSeeder.run();

    const demoUsers = await prismaService.user.findMany();

    expect(demoUsers).toHaveLength(EXPECTED_USER_COUNT);
    for (const demoUser of demoUsers) {
      expect(demoUser.passwordHash).toMatch(/^\$argon2id\$/);
      expect(demoUser.passwordHash).not.toContain(DEMO_PASSWORD);
      expect(await passwordHasher.verify(demoUser.passwordHash, DEMO_PASSWORD)).toBe(true);
    }
  });

  it('uses only addresses on the reserved demo domain, so no real person can be on it', async () => {
    await demoSeeder.run();

    const emails = (await prismaService.user.findMany({ select: { email: true } })).map(
      ({ email }) => email,
    );

    expect(emails.every((email) => email.endsWith(`@${DEMO_EMAIL_DOMAIN}`))).toBe(true);
    expect(DEMO_EMAIL_DOMAIN.endsWith('.test')).toBe(true);
  });

  it('gives each center an owner, an admin, staff and clients', async () => {
    await demoSeeder.run();
    const norteOwner = await prismaService.user.findUniqueOrThrow({
      where: { email: `owner.studio-norte@${DEMO_EMAIL_DOMAIN}` },
    });
    const multiCenterUser = await prismaService.user.findUniqueOrThrow({
      where: { email: `multi@${DEMO_EMAIL_DOMAIN}` },
    });
    const centers = await tenantPrismaService.runInUserContext(multiCenterUser.id, (client) =>
      client.center.findMany(),
    );
    const norte = centers.find(({ joinCode }) => joinCode === 'NORTE7');

    const roles = await tenantPrismaService.runInTenantContext(
      {
        userId: norteOwner.id,
        centerId: norte?.id ?? '',
        membershipId: norteOwner.id,
        role: 'owner',
        permissions: [],
      },
      (client) => client.membership.findMany({ select: { role: true } }),
    );

    expect(
      roles.map(({ role }) => role).sort((first, second) => first.localeCompare(second)),
    ).toEqual(['admin', 'client', 'client', 'client', 'owner', 'staff']);
  });

  it('puts one client in all four centers, to try "Mis centros"', async () => {
    await demoSeeder.run();
    const multiCenterUser = await prismaService.user.findUniqueOrThrow({
      where: { email: `multi@${DEMO_EMAIL_DOMAIN}` },
    });

    const memberships = await tenantPrismaService.runInUserContext(multiCenterUser.id, (client) =>
      client.membership.findMany(),
    );

    expect(memberships).toHaveLength(EXPECTED_CENTER_COUNT);
    expect(memberships.every(({ role }) => role === 'client')).toBe(true);
  });

  it('produces accounts the access guards recognise as members of their center', async () => {
    await demoSeeder.run();
    const owner = await prismaService.user.findUniqueOrThrow({
      where: { email: `owner.studio-norte@${DEMO_EMAIL_DOMAIN}` },
    });
    const centers = await tenantPrismaService.runInUserContext(owner.id, (client) =>
      client.center.findMany(),
    );
    const finder = new ActiveMembershipFinder(tenantPrismaService);

    const membership = await finder.find(owner.id, centers[0]?.id ?? '');

    expect(membership?.role).toBe('owner');
  });

  it('is idempotent: running it again changes nothing but does not fail', async () => {
    await demoSeeder.run();
    const afterFirstRun = await countRows();

    await demoSeeder.run();
    const afterSecondRun = await countRows();

    expect(afterSecondRun).toEqual(afterFirstRun);
  });

  it('restores the demo password if someone changed it while testing', async () => {
    await demoSeeder.run();
    const email = `client1.studio-norte@${DEMO_EMAIL_DOMAIN}`;
    await prismaService.user.update({
      where: { email },
      data: { passwordHash: await passwordHasher.hash('SomethingElse123') },
    });

    await demoSeeder.run();

    const restored = await prismaService.user.findUniqueOrThrow({ where: { email } });
    expect(await passwordHasher.verify(restored.passwordHash, DEMO_PASSWORD)).toBe(true);
  });

  it('refuses to run in production: the demo password is public', async () => {
    const productionSeeder = new DemoSeeder(
      tenantPrismaService,
      passwordHasher,
      new ConfigService({ NODE_ENV: 'production' }),
    );

    await expect(productionSeeder.run()).rejects.toThrow(/production/i);
    expect(await prismaService.user.count()).toBe(0);
  });
});
