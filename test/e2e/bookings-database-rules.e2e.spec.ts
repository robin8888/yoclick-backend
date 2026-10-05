import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { BookingWorld, type CreatedTestCenter, type TestService } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_HOUR = 3_600_000;

describe('database rules of services and bookings', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let service: TestService;

  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId: center.centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  function sessionData(startsAt: Date, hours = 1) {
    return {
      id: generateUuidV7(),
      centerId: center.centerId,
      serviceId: service.id,
      staffMembershipId: center.ownerMembershipId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + hours * MILLISECONDS_PER_HOUR),
    };
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    [service] = (await world.listServices(ownerUserId, center.centerId)) as [TestService];
  });

  afterAll(async () => {
    await application.close();
  });

  it('refuses two scheduled sessions of the same professional that overlap, but accepts back-to-back ones', async () => {
    const start = new Date(Date.now() + 100 * MILLISECONDS_PER_HOUR);
    await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.classSession.create({ data: sessionData(start) }),
    );

    const overlapping = world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.classSession.create({
        data: sessionData(new Date(start.getTime() + MILLISECONDS_PER_HOUR / 2)),
      }),
    );
    const backToBack = world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.classSession.create({
        data: sessionData(new Date(start.getTime() + MILLISECONDS_PER_HOUR)),
      }),
    );

    await expect(overlapping).rejects.toThrow();
    await expect(backToBack).resolves.toBeDefined();
  });

  it('frees the professional when a session is cancelled', async () => {
    const start = new Date(Date.now() + 100 * MILLISECONDS_PER_HOUR);
    const first = sessionData(start);
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({ data: first });
      await prisma.classSession.update({ where: { id: first.id }, data: { status: 'cancelled' } });
    });

    const replacement = world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.classSession.create({ data: sessionData(start) }),
    );

    await expect(replacement).resolves.toBeDefined();
  });

  it('refuses invalid services at the database level (duration, price, color)', async () => {
    const invalidFields = [{ durationMinutes: 47 }, { priceCents: -5 }, { color: 'red' }];

    for (const invalid of invalidFields) {
      const attempt = world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.service.create({
          data: {
            id: generateUuidV7(),
            centerId: center.centerId,
            name: 'Inválido',
            durationMinutes: 60,
            ...invalid,
          },
        }),
      );

      await expect(attempt).rejects.toThrow();
    }
  });

  it('gives the application role no DELETE on services, sessions and bookings', async () => {
    for (const run of [
      (prisma: Parameters<Parameters<typeof world.tenantPrismaService.runInTenantContext>[1]>[0]) =>
        prisma.service.deleteMany(),
      (prisma: Parameters<Parameters<typeof world.tenantPrismaService.runInTenantContext>[1]>[0]) =>
        prisma.classSession.deleteMany(),
      (prisma: Parameters<Parameters<typeof world.tenantPrismaService.runInTenantContext>[1]>[0]) =>
        prisma.booking.deleteMany(),
    ]) {
      await expect(
        world.tenantPrismaService.runInTenantContext(ownerActor(), run),
      ).rejects.toThrow();
    }
  });

  it('does not see sessions or services of another center in the database', async () => {
    const otherOwner = await world.fixtures.createUser('other-owner');
    const otherCenter = await world.createCenter(otherOwner, 'Otro Centro');
    const otherActor = {
      userId: otherOwner,
      centerId: otherCenter.centerId,
      membershipId: otherCenter.ownerMembershipId,
      role: 'owner',
      permissions: [],
    } as const;

    const visible = await world.tenantPrismaService.runInTenantContext(
      otherActor,
      async (prisma) => ({
        serviceCenterIds: (await prisma.service.findMany({ select: { centerId: true } })).map(
          ({ centerId }) => centerId,
        ),
        staffLinks: await prisma.serviceStaff.count(),
      }),
    );

    expect(new Set(visible.serviceCenterIds)).toEqual(new Set([otherCenter.centerId]));
    // 4 servicios de sector con un solo profesional (el propietario) cada uno.
    expect(visible.staffLinks).toBe(4);
  });
});
