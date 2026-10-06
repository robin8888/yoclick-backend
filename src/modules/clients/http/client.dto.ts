import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  CLIENT_LEVELS,
  CLIENT_STATUS_FILTERS,
  DEFAULT_CLIENT_PAGE_SIZE,
  MAX_CLIENT_PAGE_SIZE,
  MAX_GROUP_NAME_LENGTH,
  MAX_SEARCH_LENGTH,
  MIN_GROUP_NAME_LENGTH,
} from '../domain/client-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class ClientRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid() }),
) {}

export class GroupRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), groupId: z.uuid() }),
) {}

export class ClientListQueryDto extends createZodDto(
  z.strictObject({
    /** Parte del nombre o del correo. */
    search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
    /** `active`, `new` e `inactive` según su actividad; `blocked`, los bloqueados. */
    status: z.enum(CLIENT_STATUS_FILTERS).optional(),
    /** Solo las personas de este grupo. */
    groupId: z.uuid().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_CLIENT_PAGE_SIZE)
      .default(DEFAULT_CLIENT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
  }),
) {}

const clientShape = {
  membershipId: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  status: z.enum(['active', 'blocked']),
  /** Nuevo (primera semana), activo (cita en los últimos 30 días) o inactivo. */
  activity: z.enum(['new', 'active', 'inactive']),
  level: z.enum(CLIENT_LEVELS).nullable(),
  group: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  joinedAt: z.iso.datetime(),
  bookingCount: z.number().int(),
  lastBookingAt: z.iso.datetime().nullable(),
  /** La próxima cita no cancelada; `null` si no tiene ninguna por delante. */
  nextBookingAt: z.iso.datetime().nullable(),
};

export class ClientResponseDto extends createZodDto(z.strictObject(clientShape)) {}

export class ClientListResponseDto extends createZodDto(
  z.strictObject({
    /** Todos los clientes del centro, sin filtros. */
    totalClientCount: z.number().int(),
    /** Los que cumplen la búsqueda y el estado, antes de paginar. */
    matchingCount: z.number().int(),
    clients: z.array(z.strictObject(clientShape)),
  }),
) {}

export class UpdateClientRequestDto extends createZodDto(
  z
    .strictObject({
      level: z.enum(CLIENT_LEVELS).nullable().optional(),
      groupId: z.uuid().nullable().optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, 'send at least one field to change'),
) {}

const groupShape = {
  id: z.uuid(),
  name: z.string(),
  level: z.enum(CLIENT_LEVELS).nullable(),
  instructor: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }).nullable(),
  memberCount: z.number().int(),
};

export class GroupResponseDto extends createZodDto(z.strictObject(groupShape)) {}
export class GroupListResponseDto extends createZodDto(
  z.strictObject({ groups: z.array(z.strictObject(groupShape)) }),
) {}

export class CreateGroupRequestDto extends createZodDto(
  z.strictObject({
    name: z.string().trim().min(MIN_GROUP_NAME_LENGTH).max(MAX_GROUP_NAME_LENGTH),
    level: z.enum(CLIENT_LEVELS).optional(),
    instructorMembershipId: z.uuid().optional(),
  }),
) {}
