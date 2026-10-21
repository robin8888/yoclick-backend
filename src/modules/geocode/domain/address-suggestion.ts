/** Países donde opera Yoclick, con el punto que sesga la búsqueda hacia su capital. */
export const SUPPORTED_COUNTRIES = {
  ES: { latitude: 40.4168, longitude: -3.7038 },
  CO: { latitude: 4.711, longitude: -74.0721 },
} as const;

export type CountryCode = keyof typeof SUPPORTED_COUNTRIES;

export const COUNTRY_CODES = Object.keys(SUPPORTED_COUNTRIES) as CountryCode[];

/** Qué se busca: una dirección con calle (y número si existe) o solo una ciudad. */
export type SuggestionKind = 'address' | 'city';

/** Una dirección elegible con el punto del mapa que la acompaña. */
export interface AddressSuggestion {
  /** Lo que se escribe en el campo: «Calle Mayor 14, 28013 Madrid». */
  readonly label: string;
  readonly street: string | null;
  readonly houseNumber: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly latitude: number;
  readonly longitude: number;
}

/** Lo que el geocodificador da de cada resultado y esta API usa; el resto de sus campos se ignora. */
export interface GeocodedPlace {
  readonly longitude: number;
  readonly latitude: number;
  readonly name?: string | undefined;
  readonly street?: string | undefined;
  readonly houseNumber?: string | undefined;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly postcode?: string | undefined;
  readonly country?: string | undefined;
  readonly countryCode?: string | undefined;
}

const MAX_SUGGESTIONS = 5;

function joinNonEmpty(parts: readonly (string | undefined)[], separator: string): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join(separator);
}

function toAddressSuggestion(place: GeocodedPlace): AddressSuggestion | null {
  // Según el tipo de resultado el proveedor pone la calle en `street` o en `name`.
  const street = place.street ?? place.name;
  if (street === undefined || street === '') return null;

  const streetLine = joinNonEmpty([street, place.houseNumber], ' ');
  const cityLine = joinNonEmpty([place.postcode, place.city], ' ');
  return {
    label: joinNonEmpty([streetLine, cityLine], ', '),
    street,
    houseNumber: place.houseNumber ?? null,
    city: place.city ?? null,
    postcode: place.postcode ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

/** Zonas administrativas de OpenStreetMap que no son un lugar donde escribir una dirección. */
const NON_CITY_NAME_PATTERN = /^per[ií]metro/i;

function toCitySuggestion(place: GeocodedPlace, isCountryNamed: boolean): AddressSuggestion | null {
  if (place.name === undefined || place.name === '') return null;
  if (NON_CITY_NAME_PATTERN.test(place.name)) return null;
  return {
    // Con la provincia y, si no se filtró por país, el país: hay Medellines en los dos.
    label: joinNonEmpty(
      [place.name, place.state, isCountryNamed ? place.country : undefined],
      ', ',
    ),
    street: null,
    houseNumber: null,
    city: place.name,
    postcode: place.postcode ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

export interface SuggestionSelection {
  readonly kind: SuggestionKind;
  readonly countryCode?: CountryCode | undefined;
}

/**
 * Los resultados del proveedor que sirven: de los países soportados (o del pedido), con texto y sin
 * repetir etiqueta, como mucho cinco. El proveedor devuelve a veces el mismo portal dos veces.
 */
export function selectSuggestions(
  places: readonly GeocodedPlace[],
  { kind, countryCode }: SuggestionSelection,
): AddressSuggestion[] {
  const allowedCountries: readonly string[] =
    countryCode === undefined ? COUNTRY_CODES : [countryCode];
  const seenLabels = new Set<string>();
  const suggestions: AddressSuggestion[] = [];

  for (const place of places) {
    if (place.countryCode === undefined || !allowedCountries.includes(place.countryCode)) continue;
    const suggestion =
      kind === 'city'
        ? toCitySuggestion(place, countryCode === undefined)
        : toAddressSuggestion(place);
    if (suggestion === null) continue;

    const labelKey = suggestion.label.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);
    suggestions.push(suggestion);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
