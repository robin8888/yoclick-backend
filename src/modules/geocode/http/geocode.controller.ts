import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { SearchAddressSuggestionsUseCase } from '../application/search-address-suggestions.use-case';
import { AddressSuggestionsRequestDto, AddressSuggestionsResponseDto } from './geocode.dto';

/** Sugerencias de dirección para los formularios. Exige sesión, pero no pertenecer a un centro. */
@ApiTags('geocode')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('geocode')
@UserScoped()
export class GeocodeController {
  constructor(private readonly searchAddressSuggestions: SearchAddressSuggestionsUseCase) {}

  @Post('suggestions')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: RATE_LIMITS.searchAddress })
  @ApiOperation({
    operationId: 'geocode_search_suggestions',
    summary:
      'Direcciones o ciudades que encajan con lo escrito, con sus coordenadas. Responde 502 GEOCODING_UNAVAILABLE si el proveedor no contesta.',
  })
  @ApiOkResponse({ type: AddressSuggestionsResponseDto })
  async search(@Body() body: AddressSuggestionsRequestDto): Promise<Record<string, unknown>> {
    const suggestions = await this.searchAddressSuggestions.execute(body);
    return { suggestions };
  }
}
