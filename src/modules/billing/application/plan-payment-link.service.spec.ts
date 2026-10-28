import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { type Environment } from '../../../shared/config/environment.schema';
import {
  PLAN_PAYMENT_LINK_LIFETIME_DAYS,
  PlanPaymentLinkService,
} from './plan-payment-link.service';

const PEPPER_BASE64 = Buffer.alloc(32, 7).toString('base64');
const OTHER_PEPPER_BASE64 = Buffer.alloc(32, 9).toString('base64');
const NOW = new Date('2026-10-27T10:00:00.000Z');
const DAY_MS = 86_400_000;
const CLAIMS = {
  centerId: '0198a8a0-0000-7000-8000-000000000001',
  planId: 'pro',
  period: 'annual',
} as const;

function buildService(pepperBase64 = PEPPER_BASE64, publicApiUrl = 'https://api.yoclick.app/') {
  return new PlanPaymentLinkService(
    new ConfigService<Environment, true>({
      AUTH_CODE_PEPPER_BASE64: pepperBase64,
      PUBLIC_API_URL: publicApiUrl,
    }),
  );
}

function readToken(url: string): string {
  const token = new URL(url).searchParams.get('token');
  if (token === null) throw new Error('The link has no token');
  return token;
}

async function signForgedToken(options: {
  audience: string;
  claims?: Record<string, unknown>;
}): Promise<string> {
  const issuedAtSeconds = Math.floor(NOW.getTime() / 1000);
  return new SignJWT({ ...CLAIMS, ...options.claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(options.audience)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + 60)
    .sign(Buffer.from(PEPPER_BASE64, 'base64'));
}

describe('PlanPaymentLinkService', () => {
  it('builds a link on the public API address that verifies back to the same claims', async () => {
    const service = buildService();

    const url = await service.buildUrl(CLAIMS, NOW);

    expect(url.startsWith('https://api.yoclick.app/v1/billing/pay?token=')).toBe(true);
    await expect(service.verify(readToken(url), NOW)).resolves.toEqual(CLAIMS);
  });

  it('still verifies just before the link expires', async () => {
    const service = buildService();
    const token = readToken(await service.buildUrl(CLAIMS, NOW));
    const almostExpired = new Date(NOW.getTime() + PLAN_PAYMENT_LINK_LIFETIME_DAYS * DAY_MS - 1000);

    await expect(service.verify(token, almostExpired)).resolves.toEqual(CLAIMS);
  });

  it('rejects an expired link', async () => {
    const service = buildService();
    const token = readToken(await service.buildUrl(CLAIMS, NOW));
    const expired = new Date(NOW.getTime() + (PLAN_PAYMENT_LINK_LIFETIME_DAYS + 1) * DAY_MS);

    await expect(service.verify(token, expired)).rejects.toMatchObject({
      code: 'PAYMENT_LINK_INVALID',
      httpStatus: 400,
    });
  });

  it('rejects a token whose payload was changed after signing', async () => {
    const service = buildService();
    const token = readToken(await service.buildUrl(CLAIMS, NOW));
    const parts = token.split('.');
    const originalPayload = JSON.parse(
      Buffer.from(parts[1] ?? '', 'base64url').toString(),
    ) as object;
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...originalPayload, planId: 'premium' }),
    ).toString('base64url');
    const forgedToken = [parts[0], forgedPayload, parts[2]].join('.');

    await expect(service.verify(forgedToken, NOW)).rejects.toMatchObject({
      code: 'PAYMENT_LINK_INVALID',
    });
  });

  it('rejects a token signed with another key', async () => {
    const otherService = buildService(OTHER_PEPPER_BASE64);
    const token = readToken(await otherService.buildUrl(CLAIMS, NOW));

    await expect(buildService().verify(token, NOW)).rejects.toMatchObject({
      code: 'PAYMENT_LINK_INVALID',
    });
  });

  it.each([
    { name: 'for another purpose', audience: 'yoclick-app', claims: {} },
    {
      name: 'with an unknown plan',
      audience: 'yoclick-plan-payment-link',
      claims: { planId: 'gold' },
    },
    {
      name: 'with a bad center id',
      audience: 'yoclick-plan-payment-link',
      claims: { centerId: '1' },
    },
  ])('rejects a validly signed token $name', async ({ audience, claims }) => {
    const token = await signForgedToken({ audience, claims });

    await expect(buildService().verify(token, NOW)).rejects.toMatchObject({
      code: 'PAYMENT_LINK_INVALID',
    });
  });

  it('rejects text that is not a token', async () => {
    await expect(buildService().verify('not-a-token', NOW)).rejects.toMatchObject({
      code: 'PAYMENT_LINK_INVALID',
    });
  });
});
