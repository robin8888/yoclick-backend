import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MADRID = { latitude: 40.4168, longitude: -3.7038 };
const BARCELONA = { latitude: 41.3874, longitude: 2.1686 };
const SEVILLE = { latitude: 37.3891, longitude: -5.9845 };
const SIMULTANEOUS_JOIN_ATTEMPTS = 6;
const CLIENT_LIMIT = 2;

describe('joining a center: lookup, search, branding and joining', () => {
  let application: NestFastifyApplication;
  let accessTokenService: AccessTokenService;
  let fixtures: DatabaseFixtures;
  let tenantPrismaService: TenantPrismaService;

  async function request(
    method: 'GET' | 'POST',
    url: string,
    userId?: string,
    payload?: object,
  ): ReturnType<NestFastifyApplication['inject']> {
    const headers = userId
      ? { authorization: `Bearer ${(await accessTokenService.issue(userId)).token}` }
      : {};
    return application.inject({ method, url, headers, ...(payload && { payload }) });
  }

  async function countMemberships(centerId: string, userId: string): Promise<number> {
    return tenantPrismaService.runInUserContext(userId, (client) =>
      client.membership.count({ where: { centerId, userId } }),
    );
  }

  beforeAll(async () => {
    application = await createTestApplication();
    accessTokenService = application.get(AccessTokenService);
    tenantPrismaService = application.get(TenantPrismaService);
    fixtures = new DatabaseFixtures(application.get(PrismaService), tenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await application.close();
  });

  describe('GET /v1/join/code/:code', () => {
    it('finds a center by its code without a session, ignoring case and spaces', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7', { city: 'Madrid' });

      const response = await request('GET', '/v1/join/code/%20norte7');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: centerId,
        name: 'studio-norte',
        slug: 'studio-norte',
        sectorId: 'gym',
        brandColor: '#E4572E',
        city: 'Madrid',
        logoUrl: null,
      });
    });

    it('does not reveal the join code or any private data of the center', async () => {
      await fixtures.createCenter('studio-norte', 'NORTE7');

      const body = (await request('GET', '/v1/join/code/NORTE7')).json<Record<string, unknown>>();

      expect(Object.keys(body).sort((first, second) => first.localeCompare(second))).toEqual(
        ['brandColor', 'city', 'id', 'logoUrl', 'name', 'sectorId', 'slug'].sort((first, second) =>
          first.localeCompare(second),
        ),
      );
    });

    it.each(['ZZZZZZ', 'NORTE', 'NORTE77', "NORTE7'--"])(
      'answers 404 JOIN_CODE_INVALID for %j, the same way for unknown and malformed codes',
      async (code) => {
        await fixtures.createCenter('studio-norte', 'NORTE7');

        const response = await request('GET', `/v1/join/code/${encodeURIComponent(code)}`);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ code: 'JOIN_CODE_INVALID' });
      },
    );
  });

  describe('GET /v1/join/search', () => {
    beforeEach(async () => {
      await fixtures.createCenter('madrid-studio', 'MADRI1', {
        isListed: true,
        city: 'Madrid',
        ...MADRID,
      });
      await fixtures.createCenter('barna-box', 'BARNA1', {
        isListed: true,
        city: 'Barcelona',
        ...BARCELONA,
      });
      await fixtures.createCenter('secret-gym', 'SECRE1', {
        isListed: false,
        city: 'Sevilla',
        ...SEVILLE,
      });
      await fixtures.createCenter('closed-box', 'CLOSE1', { isListed: true, status: 'suspended' });
    });

    it('lists only centers that chose to be in the directory, not private or suspended ones', async () => {
      const body = (await request('GET', '/v1/join/search')).json<{
        centers: { slug: string }[];
      }>();

      expect(
        body.centers.map(({ slug }) => slug).sort((first, second) => first.localeCompare(second)),
      ).toEqual(['barna-box', 'madrid-studio']);
    });

    it('filters by text in the name or the city, case-insensitively', async () => {
      const byCity = (await request('GET', '/v1/join/search?q=barcelona')).json<{
        centers: { slug: string }[];
      }>();
      const byName = (await request('GET', '/v1/join/search?q=STUDIO')).json<{
        centers: { slug: string }[];
      }>();

      expect(byCity.centers.map(({ slug }) => slug)).toEqual(['barna-box']);
      expect(byName.centers.map(({ slug }) => slug)).toEqual(['madrid-studio']);
    });

    it('orders by distance when a location is sent, nearest first', async () => {
      const response = await request(
        'GET',
        `/v1/join/search?lat=${String(BARCELONA.latitude)}&lng=${String(BARCELONA.longitude)}`,
      );

      const { centers } = response.json<{
        centers: { slug: string; distanceInKilometers: number }[];
      }>();
      expect(centers.map(({ slug }) => slug)).toEqual(['barna-box', 'madrid-studio']);
      expect(centers[0]?.distanceInKilometers).toBeCloseTo(0, 3);
    });

    it('rejects a latitude without longitude, and out-of-range coordinates', async () => {
      const lonely = await request('GET', '/v1/join/search?lat=40');
      const impossible = await request('GET', '/v1/join/search?lat=95&lng=0');

      expect(lonely.statusCode).toBe(400);
      expect(impossible.statusCode).toBe(400);
    });
  });

  describe('GET /v1/centers/:centerId/branding', () => {
    it('is public and cacheable', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');

      const response = await request('GET', `/v1/centers/${centerId}/branding`);

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.json()).toEqual({
        centerId,
        name: 'studio-norte',
        sectorId: 'gym',
        brandColor: '#E4572E',
        logoUrl: null,
      });
    });

    it('answers 404 for a center that does not exist or is suspended', async () => {
      const suspendedId = await fixtures.createCenter('closed', 'CLOSE1', { status: 'suspended' });

      const unknown = await request(
        'GET',
        '/v1/centers/01930000-0000-7000-8000-000000000999/branding',
      );
      const suspended = await request('GET', `/v1/centers/${suspendedId}/branding`);

      expect(unknown.statusCode).toBe(404);
      expect(suspended.statusCode).toBe(404);
    });

    it('still keeps no-store on every other route', async () => {
      const response = await request('GET', '/v1/join/search');

      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('POST /v1/join/:centerId', () => {
    let person: string;

    beforeEach(async () => {
      person = await fixtures.createUser('person');
    });

    it('requires a session', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');

      const response = await request('POST', `/v1/join/${centerId}`, undefined, {
        joinCode: 'NORTE7',
      });

      expect(response.statusCode).toBe(401);
    });

    it('joins a private center as a client when the code is presented', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');

      const response = await request('POST', `/v1/join/${centerId}`, person, {
        joinCode: 'norte7',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        centerId,
        role: 'client',
        status: 'active',
        isNewMembership: true,
      });
    });

    it('does not let a private center be joined with only its id, and answers like an unknown center', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');

      const withoutCode = await request('POST', `/v1/join/${centerId}`, person, {});
      const withWrongCode = await request('POST', `/v1/join/${centerId}`, person, {
        joinCode: 'ZZZZZZ',
      });
      const unknownCenter = await request(
        'POST',
        '/v1/join/01930000-0000-7000-8000-000000000999',
        person,
        {
          joinCode: 'NORTE7',
        },
      );

      for (const response of [withoutCode, withWrongCode, unknownCenter]) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ code: 'JOIN_CODE_INVALID' });
      }
      expect(await countMemberships(centerId, person)).toBe(0);
    });

    it('tells the owner when somebody joins, once, and nobody else', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
      const owner = await fixtures.createUser('owner');
      const ownerMembershipId = await fixtures.createMembership({
        centerId,
        userId: owner,
        role: 'owner',
      });
      await request('POST', `/v1/join/${centerId}`, person, { joinCode: 'NORTE7' });
      await request('POST', `/v1/join/${centerId}`, person, { joinCode: 'NORTE7' });

      const notices = await tenantPrismaService.runInTenantContext(
        {
          userId: owner,
          centerId,
          membershipId: ownerMembershipId,
          role: 'owner',
          permissions: [],
        },
        (client) =>
          client.notification.findMany({
            select: { recipientMembershipId: true, kind: true, data: true },
          }),
      );

      expect(notices).toEqual([
        {
          recipientMembershipId: ownerMembershipId,
          kind: 'member_joined',
          data: { personName: 'person', role: 'client' },
        },
      ]);
    });

    it('lets anyone join a listed center without a code', async () => {
      const centerId = await fixtures.createCenter('barna-box', 'BARNA1', { isListed: true });

      const response = await request('POST', `/v1/join/${centerId}`, person, {});

      expect(response.statusCode).toBe(201);
    });

    it('is idempotent: joining twice leaves one membership and reports it is not new', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
      await request('POST', `/v1/join/${centerId}`, person, { joinCode: 'NORTE7' });

      const second = await request('POST', `/v1/join/${centerId}`, person, { joinCode: 'NORTE7' });

      expect(second.json()).toMatchObject({ isNewMembership: false });
      expect(await countMemberships(centerId, person)).toBe(1);
    });

    it('never downgrades or upgrades an existing role by joining again', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
      await fixtures.createMembership({ centerId, userId: person, role: 'owner' });

      const response = await request('POST', `/v1/join/${centerId}`, person, {
        joinCode: 'NORTE7',
      });

      expect(response.json()).toMatchObject({ role: 'owner', isNewMembership: false });
    });

    it('rejoins as a plain client after leaving, never recovering a former staff role', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
      await fixtures.createMembership({ centerId, userId: person, role: 'staff', status: 'left' });

      const response = await request('POST', `/v1/join/${centerId}`, person, {
        joinCode: 'NORTE7',
      });

      expect(response.json()).toMatchObject({
        role: 'client',
        status: 'active',
        isNewMembership: true,
      });
    });

    it('answers 403 MEMBERSHIP_BLOCKED to someone the center blocked', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
      await fixtures.createMembership({
        centerId,
        userId: person,
        role: 'client',
        status: 'blocked',
      });

      const response = await request('POST', `/v1/join/${centerId}`, person, {
        joinCode: 'NORTE7',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'MEMBERSHIP_BLOCKED' });
    });

    it('answers 409 CLIENT_LIMIT_REACHED when the plan limit is full', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7', { maxClients: 1 });
      const firstClient = await fixtures.createUser('first');
      await fixtures.createMembership({ centerId, userId: firstClient, role: 'client' });

      const response = await request('POST', `/v1/join/${centerId}`, person, {
        joinCode: 'NORTE7',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'CLIENT_LIMIT_REACHED' });
    });

    it('does not count staff against the client limit', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7', { maxClients: 1 });
      const staffMember = await fixtures.createUser('staff');
      await fixtures.createMembership({ centerId, userId: staffMember, role: 'staff' });

      const response = await request('POST', `/v1/join/${centerId}`, person, {
        joinCode: 'NORTE7',
      });

      expect(response.statusCode).toBe(201);
    });

    it('cannot exceed the limit with simultaneous requests', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7', {
        maxClients: CLIENT_LIMIT,
      });
      const people = await Promise.all(
        Array.from({ length: SIMULTANEOUS_JOIN_ATTEMPTS }, (_unused, index) =>
          fixtures.createUser(`racer-${String(index)}`),
        ),
      );

      const responses = await Promise.all(
        people.map((racer) =>
          request('POST', `/v1/join/${centerId}`, racer, { joinCode: 'NORTE7' }),
        ),
      );

      const joined = responses.filter(({ statusCode }) => statusCode === 201);
      expect(joined).toHaveLength(CLIENT_LIMIT);
      expect(responses.filter(({ statusCode }) => statusCode === 409)).toHaveLength(
        SIMULTANEOUS_JOIN_ATTEMPTS - CLIENT_LIMIT,
      );
    });

    it('shows the new center in "my centers" straight away', async () => {
      const centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
      await request('POST', `/v1/join/${centerId}`, person, { joinCode: 'NORTE7' });

      const memberships = (await request('GET', '/v1/me/memberships', person)).json<{
        memberships: { centerId: string }[];
      }>();

      expect(memberships.memberships.map((membership) => membership.centerId)).toEqual([centerId]);
    });

    it('rejects an invalid center id with 400', async () => {
      const response = await request('POST', '/v1/join/not-a-uuid', person, {});

      expect(response.statusCode).toBe(400);
    });
  });
});
