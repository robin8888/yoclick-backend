import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';

const MIN_SEARCH_TEXT_LENGTH = 2;
const MAX_SEARCH_TEXT_LENGTH = 80;
const MAX_JOIN_CODE_INPUT_LENGTH = 16;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

const publicCenterShape = {
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  sectorId: z.string(),
  brandColor: z.string(),
  city: z.string().nullable(),
  logoUrl: z.string().nullable(),
};

export class PublicCenterResponseDto extends createZodDto(z.strictObject(publicCenterShape)) {}

export class CenterSearchResponseDto extends createZodDto(
  z.strictObject({
    centers: z.array(
      z.strictObject({
        ...publicCenterShape,
        distanceInKilometers: z.number().nullable(),
      }),
    ),
  }),
) {}

export class JoinCodeParamsDto extends createZodDto(
  z.strictObject({ code: z.string().min(1).max(MAX_JOIN_CODE_INPUT_LENGTH) }),
) {}

export class CenterIdParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

/** Latitud y longitud van juntas o no van: una sola no sirve para ordenar por cercanía. */
export class CenterSearchQueryDto extends createZodDto(
  z
    .strictObject({
      // `q` es el nombre del parámetro en el contrato público.
      // eslint-disable-next-line id-length
      q: z.string().trim().min(MIN_SEARCH_TEXT_LENGTH).max(MAX_SEARCH_TEXT_LENGTH).optional(),
      lat: z.coerce.number().min(-MAX_LATITUDE).max(MAX_LATITUDE).optional(),
      lng: z.coerce.number().min(-MAX_LONGITUDE).max(MAX_LONGITUDE).optional(),
    })
    .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
      message: 'lat and lng must be sent together',
    }),
) {}

export class JoinCenterRequestDto extends createZodDto(
  z.strictObject({
    /** Obligatorio para un centro privado; un centro listado en el directorio no lo necesita. */
    joinCode: z.string().min(1).max(MAX_JOIN_CODE_INPUT_LENGTH).optional(),
    /** Por dónde llega la persona: QR, enlace, código escrito o buscador de centros. */
    source: z.enum(['qr', 'link', 'code', 'search']).optional(),
  }),
) {}

export class JoinCenterResponseDto extends createZodDto(
  z.strictObject({
    membershipId: z.uuid(),
    centerId: z.uuid(),
    role: z.enum(['owner', 'admin', 'staff', 'client']),
    status: z.enum(['invited', 'active', 'blocked', 'left']),
    isNewMembership: z.boolean(),
  }),
) {}
