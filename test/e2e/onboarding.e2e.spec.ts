import { randomUUID } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_OWNED_CENTERS } from '../../src/modules/onboarding/application/create-center.use-case';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { MILLISECONDS_PER_DAY } from '../../src/shared/time/time-units';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const VALID_BODY = { name: 'Studio Norte', sectorId: 'estudio', city: 'Madrid' };
const TRIAL_DAYS = 14;

interface CreatedCenterBody {
  centerId: string;
  ownerMembershipId: string;
  slug: string;
  joinCode: string;
  trialEndsAt: string;
  brandColor: string;
  isListed: boolean;
}

describe('center onboarding', () => {
  let application: NestFastifyApplication;
  let accessTokenService: AccessTokenService;
  let tenantPrismaService: TenantPrismaService;
  let fixtures: DatabaseFixtures;
  let person: string;

  async function createCenter(
    userId: string | undefined,
    body: object,
    key: string = randomUUID(),
  ) {
    const headers: Record<string, string> = { 'idempotency-key': key };
    if (userId)
      headers['authorization'] = `Bearer ${(await accessTokenService.issue(userId)).token}`;
    return application.inject({
      method: 'POST',
      url: '/v1/onboarding/centers',
      headers,
      payload: body,
    });
  }

  beforeAll(async () => {
    application = await createTestApplication();
    accessTokenService = application.get(AccessTokenService);
    tenantPrismaService = application.get(TenantPrismaService);
    fixtures = new DatabaseFixtures(application.get(PrismaService), tenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    person = await fixtures.createUser('founder');
  });

  afterAll(async () => {
    await application.close();
  });

  it('creates a trial center and makes the creator its owner', async () => {
    const response = await createCenter(person, VALID_BODY);

    expect(response.statusCode).toBe(201);
    const body = response.json<CreatedCenterBody>();
    expect(body.slug).toBe('studio-norte');
    expect(body.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(body.brandColor).toBe('#2446C7');
    const trialMs = new Date(body.trialEndsAt).getTime() - Date.now();
    expect(trialMs).toBeGreaterThan((TRIAL_DAYS - 1) * MILLISECONDS_PER_DAY);
    expect(trialMs).toBeLessThanOrEqual(TRIAL_DAYS * MILLISECONDS_PER_DAY);

    const memberships = await tenantPrismaService.runInUserContext(person, (client) =>
      client.membership.findMany({ where: { userId: person } }),
    );
    expect(memberships).toMatchObject([
      { id: body.ownerMembershipId, centerId: body.centerId, role: 'owner', status: 'active' },
    ]);
  });

  it('lets people join the new center with the code it returns', async () => {
    const body = (await createCenter(person, VALID_BODY)).json<CreatedCenterBody>();

    const lookup = await application.inject({
      method: 'GET',
      url: `/v1/join/code/${body.joinCode}`,
    });

    expect(lookup.json()).toMatchObject({ id: body.centerId, city: 'Madrid' });
  });

  it('keeps the center out of the public directory unless the founder asks to be listed', async () => {
    const unlisted = (await createCenter(person, VALID_BODY)).json<CreatedCenterBody>();
    const other = await fixtures.createUser('listed-founder');
    const listed = (
      await createCenter(other, { ...VALID_BODY, name: 'Studio Sur', isListed: true })
    ).json<CreatedCenterBody>();

    expect(unlisted.isListed).toBe(false);
    expect(listed.isListed).toBe(true);
    const stored = await tenantPrismaService.runInTenantContext(
      {
        userId: other,
        centerId: listed.centerId,
        membershipId: listed.ownerMembershipId,
        role: 'owner',
        permissions: [],
      },
      (client) => client.center.findUniqueOrThrow({ where: { id: listed.centerId } }),
    );
    expect(stored.isListed).toBe(true);
  });

  it('rejects a non-boolean isListed with 400', async () => {
    const response = await createCenter(person, { ...VALID_BODY, isListed: 'yes' });

    expect(response.statusCode).toBe(400);
  });

  it('normalizes the brand color to upper case', async () => {
    const response = await createCenter(person, { ...VALID_BODY, brandColor: '#e4572e' });

    expect(response.json<CreatedCenterBody>().brandColor).toBe('#E4572E');
  });

  it('gives a distinct slug to a second center with the same name', async () => {
    const other = await fixtures.createUser('other-founder');
    await createCenter(person, VALID_BODY);

    const second = (await createCenter(other, VALID_BODY)).json<CreatedCenterBody>();

    expect(second.slug).toMatch(/^studio-norte-[a-z0-9]{4}$/);
  });

  it('is idempotent: the same key returns the same center and creates only one', async () => {
    const key = randomUUID();

    const first = (await createCenter(person, VALID_BODY, key)).json<CreatedCenterBody>();
    const replay = (await createCenter(person, VALID_BODY, key)).json<CreatedCenterBody>();

    expect(replay.centerId).toBe(first.centerId);
    const owned = await tenantPrismaService.runInUserContext(person, (client) =>
      client.membership.count({ where: { userId: person, role: 'owner' } }),
    );
    expect(owned).toBe(1);
  });

  it('requires the Idempotency-Key header', async () => {
    const response = await application.inject({
      method: 'POST',
      url: '/v1/onboarding/centers',
      headers: { authorization: `Bearer ${(await accessTokenService.issue(person)).token}` },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('requires a session', async () => {
    const response = await createCenter(undefined, VALID_BODY);

    expect(response.statusCode).toBe(401);
  });

  it.each([
    ['an unknown sector', { ...VALID_BODY, sectorId: 'casino' }],
    ['a name that is too short', { ...VALID_BODY, name: 'A' }],
    ['a color that is not hex', { ...VALID_BODY, brandColor: 'red' }],
    [
      'unexpected fields such as a join code or status',
      { ...VALID_BODY, joinCode: 'AAAAAA', status: 'active' },
    ],
  ])('rejects %s with 400', async (_description, body) => {
    const response = await createCenter(person, body);

    expect(response.statusCode).toBe(400);
  });

  it('caps how many centers one person can own', async () => {
    for (let index = 0; index < MAX_OWNED_CENTERS; index += 1) {
      expect(
        (await createCenter(person, { ...VALID_BODY, name: `Centro ${String(index)}` })).statusCode,
      ).toBe(201);
    }

    const overLimit = await createCenter(person, VALID_BODY);

    expect(overLimit.statusCode).toBe(409);
    expect(overLimit.json()).toMatchObject({ code: 'CENTER_LIMIT_REACHED' });
  });
});
