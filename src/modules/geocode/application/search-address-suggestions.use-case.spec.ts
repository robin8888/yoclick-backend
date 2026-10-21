import { DomainError } from '../../../shared/errors/domain-error';
import { type GeocodedPlace } from '../domain/address-suggestion';
import {
  AddressProviderUnavailableError,
  type AddressSuggestionProvider,
} from './ports/address-suggestion.provider';
import { SearchAddressSuggestionsUseCase } from './search-address-suggestions.use-case';

const madridHouse: GeocodedPlace = {
  longitude: -3.7,
  latitude: 40.4,
  street: 'Calle Mayor',
  houseNumber: '14',
  city: 'Madrid',
  countryCode: 'ES',
};

function buildUseCase(provider: AddressSuggestionProvider): SearchAddressSuggestionsUseCase {
  return new SearchAddressSuggestionsUseCase(provider);
}

describe('SearchAddressSuggestionsUseCase', () => {
  it('returns the suggestions built from what the provider found', async () => {
    const useCase = buildUseCase({ searchPlaces: () => Promise.resolve([madridHouse]) });

    const suggestions = await useCase.execute({
      query: 'calle mayor 14',
      kind: 'address',
      countryCode: 'ES',
    });

    expect(suggestions.map(({ label }) => label)).toEqual(['Calle Mayor 14, Madrid']);
  });

  it('answers GEOCODING_UNAVAILABLE when the provider is down', async () => {
    const useCase = buildUseCase({
      searchPlaces: () => Promise.reject(new AddressProviderUnavailableError()),
    });

    const attempt = useCase.execute({ query: 'calle mayor', kind: 'address', countryCode: 'ES' });

    await expect(attempt).rejects.toMatchObject({
      code: 'GEOCODING_UNAVAILABLE',
      httpStatus: 502,
    });
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
  });

  it('lets unexpected errors through instead of hiding them as a provider failure', async () => {
    const useCase = buildUseCase({ searchPlaces: () => Promise.reject(new TypeError('bug')) });

    await expect(
      useCase.execute({ query: 'calle mayor', kind: 'address', countryCode: undefined }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
