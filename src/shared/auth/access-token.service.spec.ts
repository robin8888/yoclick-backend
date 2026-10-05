import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { v7 as generateUuidV7 } from 'uuid';
import { generateBase64Ed25519KeyPair } from '../../../test/support/generate-test-key-pair';
import { DomainError } from '../errors/domain-error';
import { type Environment } from '../config/environment.schema';
import { AccessTokenService } from './access-token.service';

const KEY_ID = 'test-key';
const ISSUER = 'https://api.yoclick.app';
const AUDIENCE = 'yoclick-app';
const USER_ID = '01a10685-b683-70b8-bc14-b2fed580d44c';
const ACCESS_TOKEN_LIFETIME_SECONDS = 600;
const SECONDS_IN_AN_HOUR = 3600;

function buildService(
  keyPair = generateBase64Ed25519KeyPair(),
  keyId = KEY_ID,
): AccessTokenService {
  const configuration = {
    JWT_ACCESS_PRIVATE_KEY_BASE64: keyPair.privateKeyBase64,
    JWT_ACCESS_PUBLIC_KEY_BASE64: keyPair.publicKeyBase64,
    JWT_KEY_ID: keyId,
  };
  return new AccessTokenService(new ConfigService<Environment, true>(configuration));
}

async function signForgedToken(
  privateKeyBase64: string,
  claims: { issuer?: string; audience?: string; expiresInSeconds?: number; keyId?: string },
): Promise<string> {
  const privateKey = await importPKCS8(
    Buffer.from(privateKeyBase64, 'base64').toString('utf8'),
    'EdDSA',
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid: claims.keyId ?? KEY_ID })
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(claims.audience ?? AUDIENCE)
    .setSubject(USER_ID)
    .setJti(generateUuidV7())
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? SECONDS_IN_AN_HOUR),
    )
    .sign(privateKey);
}

function toBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('AccessTokenService', () => {
  it('issues a token that verifies back to the same person', async () => {
    const service = buildService();

    const { token } = await service.issue(USER_ID);
    const claims = await service.verify(token);

    expect(claims.userId).toBe(USER_ID);
    expect(claims.tokenId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('issues short-lived tokens: 10 minutes (SEC-44)', async () => {
    const service = buildService();
    const issuedAt = Date.now();

    const { expiresAt } = await service.issue(USER_ID);

    const lifetimeSeconds = Math.round((expiresAt.getTime() - issuedAt) / 1000);
    expect(lifetimeSeconds).toBeGreaterThanOrEqual(ACCESS_TOKEN_LIFETIME_SECONDS - 2);
    expect(lifetimeSeconds).toBeLessThanOrEqual(ACCESS_TOKEN_LIFETIME_SECONDS + 2);
  });

  it('signs with EdDSA and tags the key id so keys can be rotated', async () => {
    const service = buildService();

    const { token } = await service.issue(USER_ID);

    const [encodedHeader] = token.split('.');
    const header = JSON.parse(Buffer.from(encodedHeader ?? '', 'base64url').toString('utf8')) as {
      alg: string;
      kid: string;
    };
    expect(header).toMatchObject({ alg: 'EdDSA', kid: KEY_ID });
  });

  it('gives each token its own id (jti)', async () => {
    const service = buildService();

    const first = await service.verify((await service.issue(USER_ID)).token);
    const second = await service.verify((await service.issue(USER_ID)).token);

    expect(first.tokenId).not.toBe(second.tokenId);
  });

  describe('second factor', () => {
    it('marks a normal token as password-only: it does not satisfy MFA-protected routes', async () => {
      const service = buildService();

      const claims = await service.verify((await service.issue(USER_ID)).token);

      expect(claims.isMfaVerified).toBe(false);
    });

    it('marks a token issued after a verified code, with the standard amr claim', async () => {
      const service = buildService();

      const { token } = await service.issue(USER_ID, { isMfaVerified: true });

      const claims = await service.verify(token);
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as { amr: string[] };
      expect(claims.isMfaVerified).toBe(true);
      expect(payload.amr).toEqual(['pwd', 'otp']);
    });

    it('cannot be faked by adding an amr claim to an unsigned or re-signed token', async () => {
      const service = buildService();
      const forged = `${toBase64Url({ alg: 'none' })}.${toBase64Url({
        sub: USER_ID,
        iss: ISSUER,
        aud: AUDIENCE,
        amr: ['pwd', 'otp'],
        exp: Math.floor(Date.now() / 1000) + SECONDS_IN_AN_HOUR,
      })}.`;

      const error = await captureRejection(service.verify(forged));

      expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('issues a challenge token that is valid for about five minutes', async () => {
      const service = buildService();
      const issuedAt = Date.now();

      const { token, expiresAt } = await service.issueMfaChallenge(USER_ID);

      expect(await service.verifyMfaChallenge(token)).toEqual({ userId: USER_ID });
      const lifetimeSeconds = Math.round((expiresAt.getTime() - issuedAt) / 1000);
      expect(lifetimeSeconds).toBeGreaterThanOrEqual(298);
      expect(lifetimeSeconds).toBeLessThanOrEqual(302);
    });

    it('never accepts a challenge token as an access token (different audience)', async () => {
      const service = buildService();
      const { token } = await service.issueMfaChallenge(USER_ID);

      const error = await captureRejection(service.verify(token));

      expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('never accepts an access token as a challenge token', async () => {
      const service = buildService();
      const { token } = await service.issue(USER_ID);

      const error = await captureRejection(service.verifyMfaChallenge(token));

      expect(error).toMatchObject({ code: 'SESSION_INVALID', httpStatus: 401 });
    });

    it('rejects a tampered or garbage challenge with the same 401', async () => {
      const service = buildService();
      const { token } = await service.issueMfaChallenge(USER_ID);
      const [header, , signature] = token.split('.');
      const forgedPayload = toBase64Url({ sub: 'attacker-id', iss: ISSUER });

      for (const invalid of [
        `${header ?? ''}.${forgedPayload}.${signature ?? ''}`,
        'garbage',
        '',
      ]) {
        expect(await captureRejection(service.verifyMfaChallenge(invalid))).toMatchObject({
          code: 'SESSION_INVALID',
        });
      }
    });
  });

  describe('rejects with 401 UNAUTHENTICATED, always the same error so nothing can be probed', () => {
    const keyPair = generateBase64Ed25519KeyPair();
    const service = buildService(keyPair);

    async function expectRejected(token: string): Promise<void> {
      const error = await captureRejection(service.verify(token));

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: 'UNAUTHENTICATED', httpStatus: 401 });
    }

    it.each(['', 'garbage', 'a.b.c', '....'])('malformed token %p', async (token) => {
      await expectRejected(token);
    });

    it('an expired token', async () => {
      await expectRejected(
        await signForgedToken(keyPair.privateKeyBase64, { expiresInSeconds: -60 }),
      );
    });

    it('a token for another audience', async () => {
      await expectRejected(
        await signForgedToken(keyPair.privateKeyBase64, { audience: 'someone-else' }),
      );
    });

    it('a token from another issuer', async () => {
      await expectRejected(
        await signForgedToken(keyPair.privateKeyBase64, { issuer: 'https://evil.example' }),
      );
    });

    it('a token signed with a different key', async () => {
      const attackerKeyPair = generateBase64Ed25519KeyPair();

      await expectRejected(await signForgedToken(attackerKeyPair.privateKeyBase64, {}));
    });

    it('a token with an unknown key id', async () => {
      await expectRejected(
        await signForgedToken(keyPair.privateKeyBase64, { keyId: 'unknown-key' }),
      );
    });

    it('a token whose payload was altered after signing', async () => {
      const { token } = await service.issue(USER_ID);
      const [header, , signature] = token.split('.');
      const forgedPayload = toBase64Url({ sub: 'attacker-id', iss: ISSUER, aud: AUDIENCE });

      await expectRejected(`${header ?? ''}.${forgedPayload}.${signature ?? ''}`);
    });

    it('an unsigned token with alg none', async () => {
      const unsigned = `${toBase64Url({ alg: 'none', typ: 'JWT' })}.${toBase64Url({
        sub: USER_ID,
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + SECONDS_IN_AN_HOUR,
      })}.`;

      await expectRejected(unsigned);
    });

    it('an HS256 token signed using the public key as the secret (algorithm confusion)', async () => {
      const publicKeyPem = Buffer.from(keyPair.publicKeyBase64, 'base64').toString('utf8');
      const header = toBase64Url({ alg: 'HS256', typ: 'JWT', kid: KEY_ID });
      const payload = toBase64Url({
        sub: USER_ID,
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + SECONDS_IN_AN_HOUR,
      });
      const signature = createHmac('sha256', publicKeyPem)
        .update(`${header}.${payload}`)
        .digest('base64url');

      await expectRejected(`${header}.${payload}.${signature}`);
    });
  });
});

describe('AccessTokenService check-in tokens', () => {
  const MEMBERSHIP_ID = '01a10685-b683-70b8-bc14-b2fed580d44d';
  const CENTER_ID = '01a10685-b683-70b8-bc14-b2fed580d44e';

  it('round-trips the membership and center of the client', async () => {
    const service = buildService();
    const { token } = await service.issueCheckinToken({
      membershipId: MEMBERSHIP_ID,
      centerId: CENTER_ID,
    });

    await expect(service.verifyCheckinToken(token)).resolves.toEqual({
      membershipId: MEMBERSHIP_ID,
      centerId: CENTER_ID,
    });
  });

  it('is not accepted as an access token, and an access token is not accepted as a check-in code', async () => {
    const service = buildService();
    const checkin = await service.issueCheckinToken({
      membershipId: MEMBERSHIP_ID,
      centerId: CENTER_ID,
    });
    const access = await service.issue(USER_ID);

    await expect(service.verify(checkin.token)).rejects.toBeInstanceOf(DomainError);
    await expect(service.verifyCheckinToken(access.token)).rejects.toMatchObject({
      code: 'CHECKIN_CODE_INVALID',
    });
  });

  it('expires after a few minutes', async () => {
    const service = buildService();
    const { expiresAt } = await service.issueCheckinToken({
      membershipId: MEMBERSHIP_ID,
      centerId: CENTER_ID,
    });

    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(290_000);
  });

  it('rejects text that is not a token', async () => {
    await expect(buildService().verifyCheckinToken('no-es-un-token')).rejects.toMatchObject({
      code: 'CHECKIN_CODE_INVALID',
    });
  });
});
