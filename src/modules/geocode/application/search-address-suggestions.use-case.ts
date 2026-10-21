import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { selectSuggestions, type AddressSuggestion } from '../domain/address-suggestion';
import {
  ADDRESS_SUGGESTION_PROVIDER,
  AddressProviderUnavailableError,
  type AddressSuggestionProvider,
  type PlaceSearch,
} from './ports/address-suggestion.provider';

/**
 * Sugerencias de dirección mientras se escribe. No guarda ni registra lo escrito: una dirección es
 * un dato personal y aquí solo pasa de largo hacia el proveedor.
 */
@Injectable()
export class SearchAddressSuggestionsUseCase {
  constructor(
    @Inject(ADDRESS_SUGGESTION_PROVIDER) private readonly provider: AddressSuggestionProvider,
  ) {}

  async execute(search: PlaceSearch): Promise<AddressSuggestion[]> {
    try {
      const places = await this.provider.searchPlaces(search);
      return selectSuggestions(places, search);
    } catch (error) {
      if (error instanceof AddressProviderUnavailableError) {
        throw new DomainError('GEOCODING_UNAVAILABLE', HTTP_STATUS.badGateway);
      }
      throw error;
    }
  }
}
