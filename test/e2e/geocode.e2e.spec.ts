import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ADDRESS_SUGGESTION_PROVIDER,
  AddressProviderUnavailableError,
  type AddressSuggestionProvider,
} from '../../src/modules/geocode/application/ports/address-suggestion.provider';
import { type GeocodedPlace } from '../../src/modules/geocode/domain/address-suggestion';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const madridHouse: GeocodedPlace = {
  longitude: -3.70627,
  latitude: 40.41644,
  street: 'Calle Mayor',
  houseNumber: '14',
  postcode: '28013',
  city: 'Madrid',
  countryCode: 'ES',
};

describe('POST /v1/geocode/suggestions', () => {
  let application: NestFastifyApplication;
  let accessToken: string;
  let isProviderDown = false;

  const provider: AddressSuggestionProvider = {
    searchPlaces: () =>
      isProviderDown
        ? Promise.reject(new AddressProviderUnavailableError())
        : Promise.resolve([madridHouse]),
  };

  function search(body: object, authorization = `Bearer ${accessToken}`) {
    return application.inject({
      method: 'POST',
      url: '/v1/geocode/suggestions',
      headers: { authorization },
      payload: body,
    });
  }

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [{ token: ADDRESS_SUGGESTION_PROVIDER, value: provider }],
    });
    await resetTestDatabase();
    const fixtures = new DatabaseFixtures(
      application.get(PrismaService),
      application.get(TenantPrismaService),
    );
    const userId = await fixtures.createUser('geocoder');
    accessToken = (await application.get(AccessTokenService).issue(userId, { isMfaVerified: true }))
      .token;
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(() => {
    isProviderDown = false;
  });

  it('returns the suggestions with their coordinates', async () => {
    const response = await search({ query: 'calle mayor 14', kind: 'address', countryCode: 'ES' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      suggestions: [
        {
          label: 'Calle Mayor 14, 28013 Madrid',
          street: 'Calle Mayor',
          houseNumber: '14',
          city: 'Madrid',
          postcode: '28013',
          latitude: 40.41644,
          longitude: -3.70627,
        },
      ],
    });
  });

  it('rejects a request without a session with 401', async () => {
    const response = await application.inject({
      method: 'POST',
      url: '/v1/geocode/suggestions',
      payload: { query: 'calle mayor', kind: 'address' },
    });

    expect(response.statusCode).toBe(401);
  });

  it.each([
    ['too short', { query: 'ca', kind: 'address' }],
    ['unknown kind', { query: 'calle mayor', kind: 'country' }],
    ['unsupported country', { query: 'calle mayor', kind: 'address', countryCode: 'PT' }],
    ['extra field', { query: 'calle mayor', kind: 'address', limit: 100 }],
  ])('rejects a query that is %s with 400', async (_description, body) => {
    expect((await search(body)).statusCode).toBe(400);
  });

  it('answers 502 GEOCODING_UNAVAILABLE when the provider is down', async () => {
    isProviderDown = true;

    const response = await search({ query: 'calle mayor', kind: 'address' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 'GEOCODING_UNAVAILABLE' });
  });
});
