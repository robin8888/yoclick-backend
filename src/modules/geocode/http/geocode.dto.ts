import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { COUNTRY_CODES } from '../domain/address-suggestion';

const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 200;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/** Por POST y no por GET: lo escrito es una dirección y en un GET acabaría en los logs de acceso. */
export class AddressSuggestionsRequestDto extends createZodDto(
  z.strictObject({
    query: z.string().trim().min(MIN_QUERY_LENGTH).max(MAX_QUERY_LENGTH),
    kind: z.enum(['address', 'city']),
    /** Sin país se aceptan los dos. */
    countryCode: z.enum(COUNTRY_CODES).optional(),
  }),
) {}

const suggestionShape = {
  label: z.string(),
  street: z.string().nullable(),
  houseNumber: z.string().nullable(),
  city: z.string().nullable(),
  postcode: z.string().nullable(),
  latitude: z.number().min(-MAX_LATITUDE).max(MAX_LATITUDE),
  longitude: z.number().min(-MAX_LONGITUDE).max(MAX_LONGITUDE),
};

export class AddressSuggestionsResponseDto extends createZodDto(
  z.strictObject({ suggestions: z.array(z.strictObject(suggestionShape)) }),
) {}
