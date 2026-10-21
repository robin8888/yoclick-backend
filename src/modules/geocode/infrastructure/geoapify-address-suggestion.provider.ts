import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { type Environment } from '../../../shared/config/environment.schema';
import { SUPPORTED_COUNTRIES, type GeocodedPlace } from '../domain/address-suggestion';
import {
  AddressProviderUnavailableError,
  type AddressSuggestionProvider,
  type PlaceSearch,
} from '../application/ports/address-suggestion.provider';

const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
const REQUEST_TIMEOUT_MS = 5_000;
/** Se piden más de los que se enseñan: parte se descarta por país, sin calle o repetida. */
const REQUESTED_PLACE_COUNT = 15;
const SUGGESTION_LANGUAGE = 'es';

const optionalText = z.string().optional();

// Lo que responde un tercero se valida (SEC API10); los campos que no usamos se ignoran.
const geoapifyResponseSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        name: optionalText,
        street: optionalText,
        housenumber: optionalText,
        city: optionalText,
        state: optionalText,
        postcode: optionalText,
        country: optionalText,
        country_code: optionalText,
      }),
    }),
  ),
});

function buildSearchUrl({ query, kind, countryCode }: PlaceSearch, apiKey: string): URL {
  const url = new URL(GEOAPIFY_AUTOCOMPLETE_URL);
  url.searchParams.set('text', query);
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('lang', SUGGESTION_LANGUAGE);
  url.searchParams.set('limit', String(REQUESTED_PLACE_COUNT));
  // Una ciudad se busca entre ciudades; una dirección, entre todo y el dominio se queda con las calles.
  if (kind === 'city') url.searchParams.set('type', 'city');
  const countries = countryCode === undefined ? Object.keys(SUPPORTED_COUNTRIES) : [countryCode];
  url.searchParams.set('filter', `countrycode:${countries.join(',').toLowerCase()}`);
  if (countryCode !== undefined) {
    // Sin esto «Calle 10» saldría de cualquier punto del país en vez de cerca de su capital.
    const capital = SUPPORTED_COUNTRIES[countryCode];
    const proximity = `${String(capital.longitude)},${String(capital.latitude)}`;
    url.searchParams.set('bias', `proximity:${proximity}`);
  }
  url.searchParams.set('apiKey', apiKey);
  return url;
}

/**
 * Geoapify: datos de OpenStreetMap con clave, plan gratuito de uso comercial y condiciones de servicio
 * (a diferencia de los servidores públicos de uso razonable). Es el mismo en desarrollo y en producción.
 * Si el volumen supera el plan gratuito, solo cambia el plan de la cuenta, no el código.
 *
 * La clave va en la URL de la petición saliente: nunca se registra la URL, la búsqueda ni la respuesta
 * (una dirección es un dato personal).
 */
@Injectable()
export class GeoapifyAddressSuggestionProvider implements AddressSuggestionProvider {
  constructor(
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService<Environment, true>,
  ) {}

  async searchPlaces(search: PlaceSearch): Promise<GeocodedPlace[]> {
    try {
      const apiKey = this.configService.get('GEOAPIFY_API_KEY', { infer: true });
      const response = await fetch(buildSearchUrl(search, apiKey), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`status ${String(response.status)}`);
      const { features } = geoapifyResponseSchema.parse(await response.json());
      return features.map(({ geometry, properties }) => ({
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1],
        // En las ciudades `name` es el nombre; en calles y portales no se usa (va en `street`).
        name: search.kind === 'city' ? (properties.city ?? properties.name) : undefined,
        street: properties.street,
        houseNumber: properties.housenumber,
        city: properties.city,
        state: properties.state,
        postcode: properties.postcode,
        country: properties.country,
        countryCode: properties.country_code?.toUpperCase(),
      }));
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'Address provider unavailable',
      );
      throw new AddressProviderUnavailableError();
    }
  }
}
