import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { DatabaseFixtures } from '../support/database-fixtures';
import { GuardProbeModule } from '../support/guard-probe.module';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

describe('access control: authentication, tenancy and roles', () => {
  let application: NestFastifyApplication;
  let accessTokenService: AccessTokenService;
  let fixtures: DatabaseFixtures;
  let centerAId: string;
  let centerBId: string;
  let ownerOfCenterA: string;
  let staffOfCenterA: string;
  let clientOfCenterA: string;
  let blockedStaffOfCenterA: string;
  let adminOfCenterB: string;

  async function bearerFor(userId: string): Promise<Record<string, string>> {
    const { token } = await accessTokenService.issue(userId, { isMfaVerified: true });
    return { authorization: `Bearer ${token}` };
  }

  async function get(
    url: string,
    userId: string | undefined,
    centerId?: string,
  ): ReturnType<NestFastifyApplication['inject']> {
    const headers = {
      ...(userId && (await bearerFor(userId))),
      ...(centerId && { 'x-center-id': centerId }),
    };
    return application.inject({ method: 'GET', url, headers });
  }

  beforeAll(async () => {
    application = await createTestApplication({ extraModules: [GuardProbeModule] });
    accessTokenService = application.get(AccessTokenService);
    fixtures = new DatabaseFixtures(
      application.get(PrismaService),
      application.get(TenantPrismaService),
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    centerAId = await fixtures.createCenter('center-a', 'AAAAAA');
    centerBId = await fixtures.createCenter('center-b', 'BBBBBB');
    ownerOfCenterA = await fixtures.createUser('owner-a');
    staffOfCenterA = await fixtures.createUser('staff-a');
    clientOfCenterA = await fixtures.createUser('client-a');
    blockedStaffOfCenterA = await fixtures.createUser('blocked-a');
    adminOfCenterB = await fixtures.createUser('admin-b');
    await fixtures.createMembership({ centerId: centerAId, userId: ownerOfCenterA, role: 'owner' });
    await fixtures.createMembership({ centerId: centerAId, userId: staffOfCenterA, role: 'staff' });
    await fixtures.createMembership({
      centerId: centerAId,
      userId: clientOfCenterA,
      role: 'client',
    });
    await fixtures.createMembership({
      centerId: centerAId,
      userId: blockedStaffOfCenterA,
      role: 'staff',
      status: 'blocked',
    });
    await fixtures.createMembership({ centerId: centerBId, userId: adminOfCenterB, role: 'admin' });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('authentication', () => {
    it('lets anyone reach a route declared public', async () => {
      const response = await get('/v1/probe-guards/public', undefined);

      expect(response.statusCode).toBe(200);
    });

    it('requires a token on every route that is not public', async () => {
      const response = await get('/v1/probe-guards/user', undefined);

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
      expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it.each([
      ['a malformed token', 'Bearer not-a-jwt'],
      ['the wrong scheme', 'Basic dXNlcjpwYXNz'],
      ['an empty bearer', 'Bearer '],
      ['no scheme at all', 'justatoken'],
    ])('rejects %s with 401', async (_description, authorization) => {
      const response = await application.inject({
        method: 'GET',
        url: '/v1/probe-guards/user',
        headers: { authorization },
      });

      expect(response.statusCode).toBe(401);
    });

    it('identifies the person from a valid token', async () => {
      const response = await get('/v1/probe-guards/user', staffOfCenterA);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ userId: staffOfCenterA });
    });
  });

  describe('tenancy (X-Center-Id is verified against the memberships, never trusted)', () => {
    it('lets a member reach a route of their own center with the role the route allows', async () => {
      const response = await get('/v1/probe-guards/staff-area', staffOfCenterA, centerAId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ centerId: centerAId, role: 'staff' });
    });

    it('answers 400 when a center route comes without X-Center-Id', async () => {
      const response = await get('/v1/probe-guards/staff-area', staffOfCenterA);

      expect(response.statusCode).toBe(400);
    });

    it('answers 400 when X-Center-Id is not a UUID', async () => {
      const response = await get('/v1/probe-guards/staff-area', staffOfCenterA, 'not-a-uuid');

      expect(response.statusCode).toBe(400);
    });

    it('answers 404 for a center the person does not belong to, without confirming it exists', async () => {
      const response = await get('/v1/probe-guards/staff-area', adminOfCenterB, centerAId);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('answers exactly the same for a center that does not exist at all', async () => {
      const unknownCenter = await get(
        '/v1/probe-guards/staff-area',
        staffOfCenterA,
        generateUuidV7(),
      );
      const foreignCenter = await get('/v1/probe-guards/staff-area', adminOfCenterB, centerAId);

      expect(unknownCenter.statusCode).toBe(foreignCenter.statusCode);
      expect(unknownCenter.json()).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('answers 404 when the membership is blocked', async () => {
      const response = await get('/v1/probe-guards/staff-area', blockedStaffOfCenterA, centerAId);

      expect(response.statusCode).toBe(404);
    });
  });

  describe('roles', () => {
    it('answers 403 when the member of the center has a role the route does not allow', async () => {
      const response = await get('/v1/probe-guards/staff-area', clientOfCenterA, centerAId);

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('lets staff in but not into the admin area', async () => {
      const staffArea = await get('/v1/probe-guards/staff-area', staffOfCenterA, centerAId);
      const adminArea = await get('/v1/probe-guards/admin-area', staffOfCenterA, centerAId);

      expect(staffArea.statusCode).toBe(200);
      expect(adminArea.statusCode).toBe(403);
    });

    it('lets the owner into the admin area', async () => {
      const response = await get('/v1/probe-guards/admin-area', ownerOfCenterA, centerAId);

      expect(response.statusCode).toBe(200);
    });

    it('requires a second-factor session to act as owner or admin (SEC-47)', async () => {
      const { token } = await accessTokenService.issue(ownerOfCenterA, { isMfaVerified: false });

      const response = await application.inject({
        method: 'GET',
        url: '/v1/probe-guards/admin-area',
        headers: { authorization: `Bearer ${token}`, 'x-center-id': centerAId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'MFA_REQUIRED' });
    });

    it('does not ask staff for a second factor', async () => {
      const { token } = await accessTokenService.issue(staffOfCenterA, { isMfaVerified: false });

      const response = await application.inject({
        method: 'GET',
        url: '/v1/probe-guards/staff-area',
        headers: { authorization: `Bearer ${token}`, 'x-center-id': centerAId },
      });

      expect(response.statusCode).toBe(200);
    });

    it('takes the role from the database, not from anything the client sends', async () => {
      const response = await application.inject({
        method: 'GET',
        url: '/v1/probe-guards/admin-area',
        headers: {
          ...(await bearerFor(clientOfCenterA)),
          'x-center-id': centerAId,
          'x-role': 'owner',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('deny by default (SEC-53)', () => {
    it('denies a route that forgot to declare any access policy, even to an authenticated owner', async () => {
      const response = await get('/v1/probe-guards/forgotten-policy', ownerOfCenterA, centerAId);

      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain('reached');
    });

    it('asks a stranger to authenticate before saying anything about the route', async () => {
      const response = await get('/v1/probe-guards/forgotten-policy', undefined);

      expect(response.statusCode).toBe(401);
    });
  });
});
