import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { v7 as generateUuidV7 } from 'uuid';
import { parseEnvironment } from '../../src/shared/config/parse-environment';
import { DatabaseModule } from '../../src/shared/database/database.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { resetTestDatabase } from '../support/test-database';

const MAX_CLOCK_SKEW_SECONDS = 5;
const MINUTE_IN_SECONDS = 60;

describe('database clock and time zone', () => {
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;

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
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });

  it('runs every API session in UTC', async () => {
    const [row] = await prismaService.$queryRaw<
      { timezone: string }[]
    >`select current_setting('TimeZone') as timezone`;

    expect(row?.timezone).toBe('UTC');
  });

  it('stores timestamps that agree with the database clock, with no hour offset', async () => {
    const userId = generateUuidV7();
    await prismaService.user.create({
      data: { id: userId, email: 'clock@example.test', passwordHash: 'x', fullName: 'Clock' },
    });

    const [row] = await prismaService.$queryRaw<{ ageSeconds: number }[]>`
      select extract(epoch from (now() - created_at))::float as "ageSeconds"
      from users where id = ${userId}::uuid`;

    // Con la zona de sesión mal fijada esto salía como ~7200 s (dos horas) en España.
    expect(Math.abs(row?.ageSeconds ?? Number.NaN)).toBeLessThan(MAX_CLOCK_SKEW_SECONDS);
  });

  it('keeps an expiry computed in the application consistent with a comparison made by the database', async () => {
    const userId = generateUuidV7();
    await prismaService.user.create({
      data: { id: userId, email: 'expiry@example.test', passwordHash: 'x', fullName: 'Expiry' },
    });
    const expiresAt = new Date(Date.now() + MINUTE_IN_SECONDS * 1000);

    await tenantPrismaService.runInUserContext(userId, (client) =>
      client.verificationCode.create({
        data: {
          id: generateUuidV7(),
          userId,
          purpose: 'email_verification',
          codeHash: 'x',
          expiresAt,
        },
      }),
    );
    const [row] = await tenantPrismaService.runInUserContext(
      userId,
      (client) =>
        client.$queryRaw<{ remainingSeconds: number }[]>`
          select extract(epoch from (expires_at - now()))::float as "remainingSeconds"
          from verification_codes`,
    );

    expect(row?.remainingSeconds ?? Number.NaN).toBeGreaterThan(
      MINUTE_IN_SECONDS - MAX_CLOCK_SKEW_SECONDS,
    );
    expect(row?.remainingSeconds ?? Number.NaN).toBeLessThanOrEqual(MINUTE_IN_SECONDS);
  });
});
