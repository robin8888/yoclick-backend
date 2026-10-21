import { Module } from '@nestjs/common';
import { ADDRESS_SUGGESTION_PROVIDER } from './application/ports/address-suggestion.provider';
import { SearchAddressSuggestionsUseCase } from './application/search-address-suggestions.use-case';
import { GeocodeController } from './http/geocode.controller';
import { GeoapifyAddressSuggestionProvider } from './infrastructure/geoapify-address-suggestion.provider';

@Module({
  controllers: [GeocodeController],
  providers: [
    SearchAddressSuggestionsUseCase,
    { provide: ADDRESS_SUGGESTION_PROVIDER, useClass: GeoapifyAddressSuggestionProvider },
  ],
})
export class GeocodeModule {}
