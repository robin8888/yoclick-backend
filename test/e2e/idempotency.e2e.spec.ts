import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { v7 as generateUuidV7 } from 'uuid';
import { parseEnvironment } from '../../src/shared/config/parse-environment';
import { DatabaseModule } from '../../src/shared/database/database.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { DomainError } from '../../src/shared/errors/domain-error';
import { IdempotencyModule } from '../../src/shared/idempotency/idempotency.module';
import { IdempotencyService } from '../../src/shared/idempotency/idempotency.service';
import { readRequiredEnvironmentVariable, resetTestDatabase } from '../support/test-database';

const OPERATION = 'POST /v1/bookings';
const REQUEST_BODY = { serviceId: 'service-1', startsAt: '2026-10-05T10:00:00Z' };
const CREATED = { status: 201, body: { bookingId: 'booking-1' } };
const CONCURRENT_REQUEST_COUNT = 10;
const STALE_LOCK_AGE_SECONDS = 120;
const EXPIRED_AGE_DAYS = 2;

describe('idempotent operations', () => {
  let prismaService: PrismaService;
  let idempotencyService: IdempotencyService;
  let anaUserId: string;
  let beaUserId: string;

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

  /** El dueño de la tabla también está sujeto a RLS (FORCE), así que se fija el usuario antes. */
  async function ageStoredKeyAsOwner(userId: string, setClause: string): Promise<void> {
    const client = new Client({
      connectionString: readRequiredEnvironmentVariable('TEST_MIGRATION_DATABASE_URL'),
    });
    await client.connect();
    try {
      await client.query("select set_config('app.user_id', $1, false)", [userId]);
      await client.query(`update idempotency_keys set ${setClause}`);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: parseEnvironment }),
        DatabaseModule,
        IdempotencyModule,
      ],
    }).compile();
    await testingModule.init();
    prismaService = testingModule.get(PrismaService);
    idempotencyService = testingModule.get(IdempotencyService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    anaUserId = await createUser('ana');
    beaUserId = await createUser('bea');
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });

  it('runs the operation the first time and stores its response', async () => {
    const work = jest.fn().mockResolvedValue(CREATED);

    const outcome = await idempotencyService.execute({
      userId: anaUserId,
      key: generateUuidV7(),
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work,
    });

    expect(work).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ...CREATED, wasReplayed: false });
  });

  it('replays the stored response on a retry without running the operation again', async () => {
    const key = generateUuidV7();
    const work = jest.fn().mockResolvedValue(CREATED);
    const request = {
      userId: anaUserId,
      key,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work,
    };

    await idempotencyService.execute(request);
    const retry = await idempotencyService.execute(request);

    expect(work).toHaveBeenCalledTimes(1);
    expect(retry).toEqual({ ...CREATED, wasReplayed: true });
  });

  it('rejects the same key sent with a different body (422 IDEMPOTENCY_KEY_REUSED)', async () => {
    const key = generateUuidV7();
    const work = jest.fn().mockResolvedValue(CREATED);
    await idempotencyService.execute({
      userId: anaUserId,
      key,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work,
    });

    const reuse = idempotencyService.execute({
      userId: anaUserId,
      key,
      operation: OPERATION,
      requestBody: { ...REQUEST_BODY, serviceId: 'another-service' },
      work,
    });

    await expect(reuse).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', httpStatus: 422 });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('runs the operation once when many identical requests arrive at the same time', async () => {
    const key = generateUuidV7();
    const work = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return CREATED;
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUEST_COUNT }, () =>
        idempotencyService.execute({
          userId: anaUserId,
          key,
          operation: OPERATION,
          requestBody: REQUEST_BODY,
          work,
        }),
      ),
    );

    expect(work).toHaveBeenCalledTimes(1);
    const rejections = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(
      rejections.every(
        (rejection) =>
          rejection.reason instanceof DomainError &&
          rejection.reason.code === 'IDEMPOTENCY_IN_PROGRESS',
      ),
    ).toBe(true);
  });

  it('releases the key when the operation fails so the client can retry (nothing was done)', async () => {
    const key = generateUuidV7();
    const failingWork = jest.fn().mockRejectedValue(new DomainError('CONFLICT', 409));
    const request = { userId: anaUserId, key, operation: OPERATION, requestBody: REQUEST_BODY };

    await expect(idempotencyService.execute({ ...request, work: failingWork })).rejects.toThrow();
    const succeedingWork = jest.fn().mockResolvedValue(CREATED);
    const retry = await idempotencyService.execute({ ...request, work: succeedingWork });

    expect(succeedingWork).toHaveBeenCalledTimes(1);
    expect(retry.wasReplayed).toBe(false);
  });

  it('keeps keys independent per person: the same key from another user is a new request', async () => {
    const sharedKey = generateUuidV7();
    const anaWork = jest.fn().mockResolvedValue({ status: 201, body: { owner: 'ana' } });
    const beaWork = jest.fn().mockResolvedValue({ status: 201, body: { owner: 'bea' } });

    await idempotencyService.execute({
      userId: anaUserId,
      key: sharedKey,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work: anaWork,
    });
    const beaOutcome = await idempotencyService.execute({
      userId: beaUserId,
      key: sharedKey,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work: beaWork,
    });

    expect(beaWork).toHaveBeenCalledTimes(1);
    expect(beaOutcome).toEqual({ status: 201, body: { owner: 'bea' }, wasReplayed: false });
  });

  it('takes over a request that crashed midway once its lock is stale', async () => {
    const key = generateUuidV7();
    const crashedWork = jest.fn().mockImplementation(() => {
      throw new Error('process killed');
    });
    await expect(
      idempotencyService.execute({
        userId: anaUserId,
        key,
        operation: OPERATION,
        requestBody: REQUEST_BODY,
        work: crashedWork,
      }),
    ).rejects.toThrow();
    // Se simula un proceso que murió dejando la clave "en curso" hace dos minutos.
    await ageStoredKeyAsOwner(
      anaUserId,
      `status = 'in_progress', response_status = null, response_body = null,
       created_at = now() - interval '${String(STALE_LOCK_AGE_SECONDS)} seconds'`,
    );
    const recoveredWork = jest.fn().mockResolvedValue(CREATED);

    const outcome = await idempotencyService.execute({
      userId: anaUserId,
      key,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work: recoveredWork,
    });

    expect(recoveredWork).toHaveBeenCalledTimes(1);
    expect(outcome.wasReplayed).toBe(false);
  });

  it('answers 409 IDEMPOTENCY_IN_PROGRESS while a recent request is still running', async () => {
    const key = generateUuidV7();
    const slowWork = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return CREATED;
    });
    const firstRequest = idempotencyService.execute({
      userId: anaUserId,
      key,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work: slowWork,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const concurrentRetry = idempotencyService.execute({
      userId: anaUserId,
      key,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work: slowWork,
    });

    await expect(concurrentRetry).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      httpStatus: 409,
    });
    await firstRequest;
  });

  it('runs the operation again once the stored key has expired', async () => {
    const key = generateUuidV7();
    const work = jest.fn().mockResolvedValue(CREATED);
    const request = {
      userId: anaUserId,
      key,
      operation: OPERATION,
      requestBody: REQUEST_BODY,
      work,
    };
    await idempotencyService.execute(request);
    await ageStoredKeyAsOwner(
      anaUserId,
      `expires_at = now() - interval '${String(EXPIRED_AGE_DAYS)} days'`,
    );

    const outcome = await idempotencyService.execute(request);

    expect(work).toHaveBeenCalledTimes(2);
    expect(outcome.wasReplayed).toBe(false);
  });
});
