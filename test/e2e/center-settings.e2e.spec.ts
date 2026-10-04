import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const OPENING_HOURS = {
  mon: [
    { opensAt: '09:00', closesAt: '14:00' },
    { opensAt: '16:00', closesAt: '20:00' },
  ],
  sat: [{ opensAt: '10:00', closesAt: '13:00' }],
};
const SIMULTANEOUS_EDITS = 5;

describe('center settings (ETag / If-Match)', () => {
  let application: NestFastifyApplication;
  let accessTokenService: AccessTokenService;
  let fixtures: DatabaseFixtures;
  let centerId: string;
  let otherCenterId: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let client: string;
  let foreignOwner: string;

  async function call(
    method: 'GET' | 'PATCH',
    userId: string,
    options: { center?: string; routeCenter?: string; ifMatch?: string; body?: object } = {},
  ) {
    const token = (await accessTokenService.issue(userId, { isMfaVerified: true })).token;
    const targetCenter = options.center ?? centerId;
    return application.inject({
      method,
      url: `/v1/centers/${options.routeCenter ?? targetCenter}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-center-id': targetCenter,
        ...(options.ifMatch && { 'if-match': options.ifMatch }),
      },
      ...(options.body && { payload: options.body }),
    });
  }

  async function currentEtag(): Promise<string> {
    return (await call('GET', owner)).headers['etag'] as string;
  }

  beforeAll(async () => {
    application = await createTestApplication();
    accessTokenService = application.get(AccessTokenService);
    fixtures = new DatabaseFixtures(
      application.get(PrismaService),
      application.get(TenantPrismaService),
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
    otherCenterId = await fixtures.createCenter('otro', 'OTRO22');
    owner = await fixtures.createUser('owner');
    admin = await fixtures.createUser('admin');
    staff = await fixtures.createUser('staff');
    client = await fixtures.createUser('client');
    foreignOwner = await fixtures.createUser('foreign-owner');
    await fixtures.createMembership({ centerId, userId: owner, role: 'owner' });
    await fixtures.createMembership({ centerId, userId: admin, role: 'admin' });
    await fixtures.createMembership({ centerId, userId: staff, role: 'staff' });
    await fixtures.createMembership({ centerId, userId: client, role: 'client' });
    await fixtures.createMembership({
      centerId: otherCenterId,
      userId: foreignOwner,
      role: 'owner',
    });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('reading', () => {
    it('returns the settings with an ETag for owners and admins, but not the internal version', async () => {
      const response = await call('GET', owner);

      expect(response.statusCode).toBe(200);
      expect(response.headers['etag']).toMatch(/^W\/"/);
      expect(response.json()).toMatchObject({
        id: centerId,
        slug: 'studio-norte',
        joinCode: 'NORTE7',
        status: 'trial',
        openingHours: null,
      });
      expect(response.json()).not.toHaveProperty('updatedAt');
      expect((await call('GET', admin)).statusCode).toBe(200);
    });

    it.each([
      ['staff', () => staff],
      ['a client', () => client],
    ])('forbids %s', async (_label, who) => {
      expect((await call('GET', who())).statusCode).toBe(403);
    });

    it('answers 404 when the route id is not the center of the X-Center-Id header', async () => {
      const response = await call('GET', owner, { routeCenter: otherCenterId });

      expect(response.statusCode).toBe(404);
    });

    it('does not let an owner of another center read or edit this one', async () => {
      const read = await call('GET', foreignOwner, { center: centerId });
      const edit = await call('PATCH', foreignOwner, {
        center: centerId,
        ifMatch: '*',
        body: { name: 'Hackeado' },
      });

      expect(read.statusCode).toBe(404);
      expect(edit.statusCode).toBe(404);
    });
  });

  describe('editing', () => {
    it('applies the change, returns a new ETag and keeps untouched fields', async () => {
      const etag = await currentEtag();

      const response = await call('PATCH', owner, {
        ifMatch: etag,
        body: {
          name: 'Studio Norte Madrid',
          brandColor: '#e4572e',
          openingHours: OPENING_HOURS,
          holidays: [{ date: '2026-12-25', label: 'Navidad' }],
          cancelPolicy: { freeCancellationHours: 24, lateCancellationConsumesCredit: true },
          city: 'Madrid',
          latitude: 40.4168,
          longitude: -3.7038,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['etag']).not.toBe(etag);
      expect(response.json()).toMatchObject({
        name: 'Studio Norte Madrid',
        brandColor: '#E4572E',
        slug: 'studio-norte',
        joinCode: 'NORTE7',
        openingHours: OPENING_HOURS,
        city: 'Madrid',
      });
    });

    it('lets an admin edit, and null clears an optional field', async () => {
      await call('PATCH', owner, { ifMatch: await currentEtag(), body: { city: 'Madrid' } });

      const response = await call('PATCH', admin, {
        ifMatch: await currentEtag(),
        body: { city: null },
      });

      expect(response.json()).toMatchObject({ city: null });
    });

    it('answers 428 without If-Match', async () => {
      const response = await call('PATCH', owner, { body: { name: 'Nuevo nombre' } });

      expect(response.statusCode).toBe(428);
      expect(response.json()).toMatchObject({ code: 'PRECONDITION_REQUIRED' });
    });

    it('answers 412 with a stale If-Match and does not overwrite the other change', async () => {
      const staleEtag = await currentEtag();
      await call('PATCH', admin, { ifMatch: staleEtag, body: { name: 'Cambio del admin' } });

      const response = await call('PATCH', owner, {
        ifMatch: staleEtag,
        body: { name: 'Cambio de la dueña' },
      });

      expect(response.statusCode).toBe(412);
      expect(response.json()).toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect((await call('GET', owner)).json()).toMatchObject({ name: 'Cambio del admin' });
    });

    it('lets only one of several simultaneous edits with the same ETag win', async () => {
      const etag = await currentEtag();

      const responses = await Promise.all(
        Array.from({ length: SIMULTANEOUS_EDITS }, (_unused, index) =>
          call('PATCH', owner, { ifMatch: etag, body: { name: `Nombre ${String(index)}` } }),
        ),
      );

      expect(responses.filter(({ statusCode }) => statusCode === 200)).toHaveLength(1);
      expect(responses.filter(({ statusCode }) => statusCode === 412)).toHaveLength(
        SIMULTANEOUS_EDITS - 1,
      );
    });

    it('forbids staff and clients', async () => {
      const etag = await currentEtag();

      expect(
        (await call('PATCH', staff, { ifMatch: etag, body: { name: 'X Y' } })).statusCode,
      ).toBe(403);
      expect(
        (await call('PATCH', client, { ifMatch: etag, body: { name: 'X Y' } })).statusCode,
      ).toBe(403);
    });

    it.each([
      ['an empty body', {}],
      ['a protected field (slug)', { slug: 'otro-slug' }],
      ['a protected field (status)', { status: 'active' }],
      ['a protected field (joinCode)', { joinCode: 'AAAAAA' }],
      ['a protected field (maxClients)', { maxClients: 100000 }],
      ['a bad color', { brandColor: 'rojo' }],
      ['an unknown time zone', { timezone: 'Mars/Olympus' }],
      ['latitude without longitude', { latitude: 40 }],
      [
        'opening hours that close before opening',
        { openingHours: { mon: [{ opensAt: '14:00', closesAt: '09:00' }] } },
      ],
      [
        'overlapping opening hours',
        {
          openingHours: {
            mon: [
              { opensAt: '09:00', closesAt: '13:00' },
              { opensAt: '12:00', closesAt: '16:00' },
            ],
          },
        },
      ],
      ['an invalid day key', { openingHours: { funday: [] } }],
      ['a malformed time', { openingHours: { mon: [{ opensAt: '9am', closesAt: '14:00' }] } }],
      [
        'a duplicated holiday',
        {
          holidays: [
            { date: '2026-12-25', label: 'A' },
            { date: '2026-12-25', label: 'B' },
          ],
        },
      ],
      ['an impossible date', { holidays: [{ date: '2026-02-31', label: 'X' }] }],
      [
        'a negative cancellation window',
        { cancelPolicy: { freeCancellationHours: -1, lateCancellationConsumesCredit: false } },
      ],
    ])('rejects %s with 400 and changes nothing', async (_description, body) => {
      const etag = await currentEtag();

      const response = await call('PATCH', owner, { ifMatch: etag, body });

      expect(response.statusCode).toBe(400);
      expect(await currentEtag()).toBe(etag);
    });

    it('keeps the unlisted/listed flag editable so a center can join the public directory', async () => {
      const response = await call('PATCH', owner, {
        ifMatch: await currentEtag(),
        body: { isListed: true },
      });
      const directory = await application.inject({ method: 'GET', url: '/v1/join/search' });

      expect(response.json()).toMatchObject({ isListed: true });
      expect(
        directory.json<{ centers: { slug: string }[] }>().centers.map(({ slug }) => slug),
      ).toContain('studio-norte');
    });
  });
});
