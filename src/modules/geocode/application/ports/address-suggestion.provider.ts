import {
  type CountryCode,
  type GeocodedPlace,
  type SuggestionKind,
} from '../../domain/address-suggestion';

export interface PlaceSearch {
  readonly query: string;
  readonly kind: SuggestionKind;
  readonly countryCode?: CountryCode | undefined;
}

/** El geocodificador externo. Lanza `AddressProviderUnavailableError` si no responde. */
export interface AddressSuggestionProvider {
  searchPlaces(search: PlaceSearch): Promise<GeocodedPlace[]>;
}

export const ADDRESS_SUGGESTION_PROVIDER = Symbol('ADDRESS_SUGGESTION_PROVIDER');

export class AddressProviderUnavailableError extends Error {}
