import { selectSuggestions, type GeocodedPlace } from './address-suggestion';

const madridHouse: GeocodedPlace = {
  longitude: -3.70627,
  latitude: 40.41644,
  street: 'Calle Mayor',
  houseNumber: '14',
  postcode: '28013',
  city: 'Madrid',
  countryCode: 'ES',
};
const bogotaStreet: GeocodedPlace = {
  longitude: -74.0286,
  latitude: 4.7159,
  name: 'Avenida Carrera 7',
  city: 'Bogotá',
  postcode: '110121',
  countryCode: 'CO',
};

describe('selectSuggestions for addresses', () => {
  it('writes a Spanish house as street, number, postcode and city', () => {
    const [suggestion] = selectSuggestions([madridHouse], { kind: 'address', countryCode: 'ES' });

    expect(suggestion).toEqual({
      label: 'Calle Mayor 14, 28013 Madrid',
      street: 'Calle Mayor',
      houseNumber: '14',
      city: 'Madrid',
      postcode: '28013',
      latitude: 40.41644,
      longitude: -3.70627,
    });
  });

  it('uses the name of a street result and leaves the house number empty', () => {
    const [suggestion] = selectSuggestions([bogotaStreet], { kind: 'address', countryCode: 'CO' });

    expect(suggestion).toMatchObject({
      label: 'Avenida Carrera 7, 110121 Bogotá',
      street: 'Avenida Carrera 7',
      houseNumber: null,
    });
  });

  it('keeps only the requested country', () => {
    const suggestions = selectSuggestions([madridHouse, bogotaStreet], {
      kind: 'address',
      countryCode: 'CO',
    });

    expect(suggestions.map(({ city }) => city)).toEqual(['Bogotá']);
  });

  it('accepts both supported countries when none is requested and drops the rest', () => {
    const portugal: GeocodedPlace = { ...madridHouse, countryCode: 'PT', city: 'Lisboa' };

    const suggestions = selectSuggestions([madridHouse, bogotaStreet, portugal], {
      kind: 'address',
      countryCode: undefined,
    });

    expect(suggestions).toHaveLength(2);
  });

  it('skips results without a street and repeated labels', () => {
    const withoutStreet: GeocodedPlace = { ...madridHouse, street: undefined };

    const suggestions = selectSuggestions([withoutStreet, madridHouse, { ...madridHouse }], {
      kind: 'address',
      countryCode: 'ES',
    });

    expect(suggestions).toHaveLength(1);
  });

  it('returns at most five suggestions', () => {
    const manyHouses = Array.from({ length: 8 }, (_, index) => ({
      ...madridHouse,
      houseNumber: String(index + 1),
    }));

    expect(selectSuggestions(manyHouses, { kind: 'address', countryCode: 'ES' })).toHaveLength(5);
  });
});

describe('selectSuggestions for cities', () => {
  const medellin: GeocodedPlace = {
    longitude: -75.6,
    latitude: 6.26,
    name: 'Medellín',
    state: 'Antioquia',
    country: 'Colombia',
    countryCode: 'CO',
  };

  it('names the country only when the search was not narrowed to one', () => {
    const [narrowed] = selectSuggestions([medellin], { kind: 'city', countryCode: 'CO' });
    const [open] = selectSuggestions([medellin], { kind: 'city', countryCode: undefined });

    expect(narrowed?.label).toBe('Medellín, Antioquia');
    expect(open?.label).toBe('Medellín, Antioquia, Colombia');
  });
});
