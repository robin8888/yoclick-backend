import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_LOGO_BYTES } from '../../src/modules/onboarding/domain/center-logo-image';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { MAX_REQUEST_BODY_BYTES } from '../../src/shared/create-fastify-adapter';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TINY_PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('logo-test-content')]);
const OTHER_PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('another-logo-content')]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const SVG_IMAGE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
const JOIN_CODE = 'LOGO77';

function buildPngOfSize(totalBytes: number): Buffer {
  const bytes = Buffer.alloc(totalBytes);
  bytes.set(PNG_SIGNATURE);
  return bytes;
}

describe('center logo', () => {
  let application: NestFastifyApplication;
  let accessTokenService: AccessTokenService;
  let fixtures: DatabaseFixtures;
  let tenantPrismaService: TenantPrismaService;
  let ownerUserId: string;
  let adminUserId: string;
  let strangerUserId: string;
  let centerId: string;

  async function uploadLogo(
    userId: string | undefined,
    targetCenterId: string,
    body: { contentType: string; dataBase64: string },
  ) {
    const headers: Record<string, string> = {};
    if (userId) {
      headers['authorization'] = `Bearer ${(await accessTokenService.issue(userId)).token}`;
    }
    return application.inject({
      method: 'PUT',
      url: `/v1/onboarding/centers/${targetCenterId}/logo`,
      headers,
      payload: body,
    });
  }

  function uploadPng(userId: string | undefined, image: Buffer = TINY_PNG) {
    return uploadLogo(userId, centerId, {
      contentType: 'image/png',
      dataBase64: image.toString('base64'),
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
    ownerUserId = await fixtures.createUser('logo-owner');
    adminUserId = await fixtures.createUser('logo-admin');
    strangerUserId = await fixtures.createUser('logo-stranger');
    centerId = await fixtures.createCenter('logo-center', JOIN_CODE);
    await fixtures.createMembership({ centerId, userId: ownerUserId, role: 'owner' });
    await fixtures.createMembership({ centerId, userId: adminUserId, role: 'admin' });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('PUT /v1/onboarding/centers/:centerId/logo', () => {
    it('lets the owner upload a PNG and returns its relative versioned URL', async () => {
      const response = await uploadPng(ownerUserId);

      expect(response.statusCode).toBe(200);
      expect(response.json<{ logoUrl: string }>().logoUrl).toMatch(
        new RegExp(`^/v1/centers/${centerId}/logo\\?v=\\d+$`),
      );
    });

    it('requires authentication', async () => {
      expect((await uploadPng(undefined)).statusCode).toBe(401);
    });

    it('answers 404 to an admin who is not the owner', async () => {
      expect((await uploadPng(adminUserId)).statusCode).toBe(404);
    });

    it('answers 404 to a user with no membership in the center', async () => {
      expect((await uploadPng(strangerUserId)).statusCode).toBe(404);
    });

    it('answers 404 to the owner of another center who targets this one', async () => {
      const otherCenterId = await fixtures.createCenter('other-logo-center', 'OTHR77');
      await fixtures.createMembership({
        centerId: otherCenterId,
        userId: strangerUserId,
        role: 'owner',
      });

      expect((await uploadPng(strangerUserId)).statusCode).toBe(404);
    });

    it('answers 404 for a center that does not exist', async () => {
      const response = await uploadLogo(ownerUserId, '01a10be3-3b75-73fb-a81c-000000000000', {
        contentType: 'image/png',
        dataBase64: TINY_PNG.toString('base64'),
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects an SVG with 422 LOGO_INVALID', async () => {
      const response = await uploadLogo(ownerUserId, centerId, {
        contentType: 'image/png',
        dataBase64: SVG_IMAGE.toString('base64'),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ code: string }>().code).toBe('LOGO_INVALID');
    });

    it('rejects a declared SVG content type with 400, it is not in the allowed list', async () => {
      const response = await uploadLogo(ownerUserId, centerId, {
        contentType: 'image/svg+xml',
        dataBase64: SVG_IMAGE.toString('base64'),
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects a file whose bytes do not match the declared type with 422 LOGO_INVALID', async () => {
      const response = await uploadLogo(ownerUserId, centerId, {
        contentType: 'image/png',
        dataBase64: Buffer.concat([JPEG_SIGNATURE, Buffer.from('xx')]).toString('base64'),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ code: string }>().code).toBe('LOGO_INVALID');
    });

    it('rejects malformed base64 with 422 LOGO_INVALID', async () => {
      const response = await uploadLogo(ownerUserId, centerId, {
        contentType: 'image/png',
        dataBase64: 'not base64!!',
      });

      expect(response.statusCode).toBe(422);
    });

    it('accepts a logo of exactly 700 KB and fits within the global body limit', async () => {
      const dataBase64 = buildPngOfSize(MAX_LOGO_BYTES).toString('base64');
      const requestBodyBytes = Buffer.byteLength(
        JSON.stringify({ contentType: 'image/png', dataBase64 }),
      );

      const response = await uploadLogo(ownerUserId, centerId, {
        contentType: 'image/png',
        dataBase64,
      });

      expect(requestBodyBytes).toBeLessThan(MAX_REQUEST_BODY_BYTES);
      expect(response.statusCode).toBe(200);
    });

    it('rejects a logo over 700 KB with 413 LOGO_TOO_LARGE', async () => {
      const response = await uploadPng(ownerUserId, buildPngOfSize(MAX_LOGO_BYTES + 1));

      expect(response.statusCode).toBe(413);
      expect(response.json<{ code: string }>().code).toBe('LOGO_TOO_LARGE');
    });
  });

  describe('GET /v1/centers/:centerId/logo', () => {
    it('answers 404 while the center has no logo', async () => {
      const response = await application.inject({
        method: 'GET',
        url: `/v1/centers/${centerId}/logo`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('serves the same bytes with content type, ETag, cache and nosniff headers, without a session', async () => {
      await uploadPng(ownerUserId);

      const response = await application.inject({
        method: 'GET',
        url: `/v1/centers/${centerId}/logo`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.equals(TINY_PNG)).toBe(true);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/);
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('answers 304 when If-None-Match carries the current ETag', async () => {
      await uploadPng(ownerUserId);
      const first = await application.inject({
        method: 'GET',
        url: `/v1/centers/${centerId}/logo`,
      });

      const revalidation = await application.inject({
        method: 'GET',
        url: `/v1/centers/${centerId}/logo`,
        headers: { 'if-none-match': String(first.headers['etag']) },
      });

      expect(revalidation.statusCode).toBe(304);
      expect(revalidation.rawPayload).toHaveLength(0);
    });

    it('replaces the previous logo when another one is uploaded', async () => {
      await uploadPng(ownerUserId);
      await uploadPng(ownerUserId, OTHER_PNG);

      const response = await application.inject({
        method: 'GET',
        url: `/v1/centers/${centerId}/logo`,
      });

      expect(response.rawPayload.equals(OTHER_PNG)).toBe(true);
    });

    it('answers 404 for a suspended center', async () => {
      const suspendedCenterId = await fixtures.createCenter('suspended-logo', 'SUSP77', {
        status: 'suspended',
      });
      const suspendedOwnerId = await fixtures.createUser('suspended-owner');
      await fixtures.createMembership({
        centerId: suspendedCenterId,
        userId: suspendedOwnerId,
        role: 'owner',
      });
      await uploadLogo(suspendedOwnerId, suspendedCenterId, {
        contentType: 'image/png',
        dataBase64: TINY_PNG.toString('base64'),
      });

      const response = await application.inject({
        method: 'GET',
        url: `/v1/centers/${suspendedCenterId}/logo`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('logoUrl in public responses', () => {
    async function readJson(url: string): Promise<{ logoUrl: string | null }> {
      const response = await application.inject({ method: 'GET', url });
      return response.json<{ logoUrl: string | null }>();
    }

    it('is null before a logo exists', async () => {
      expect((await readJson(`/v1/centers/${centerId}/branding`)).logoUrl).toBeNull();
      expect((await readJson(`/v1/join/code/${JOIN_CODE}`)).logoUrl).toBeNull();
    });

    it('is the same relative URL in branding and join-by-code after the upload', async () => {
      const { logoUrl } = (await uploadPng(ownerUserId)).json<{ logoUrl: string }>();

      expect((await readJson(`/v1/centers/${centerId}/branding`)).logoUrl).toBe(logoUrl);
      expect((await readJson(`/v1/join/code/${JOIN_CODE}`)).logoUrl).toBe(logoUrl);
    });
  });
});
