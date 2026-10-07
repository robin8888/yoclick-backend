import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { MAX_IMPORT_ROWS } from '../domain/client-import-rules';
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
    /**
     * Solo cambia algo para la profesional: `mine` (por defecto) son quienes han reservado con
     * ella; `center` son todas las del centro, para ponerle una cita a alguien nuevo.
     */
    scope: z.enum(['mine', 'center']).default('mine'),
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

const MAX_IMPORT_NAME_LENGTH = 120;
const MAX_IMPORT_EMAIL_LENGTH = 254;
const MAX_IMPORT_PHONE_LENGTH = 30;

/** Una cadena vacía (celda en blanco del CSV) cuenta como "no viene". */
const blankToNull = (value: unknown): unknown => (value === '' ? null : value);

export class ImportClientsRequestDto extends createZodDto(
  z.strictObject({
    rows: z
      .array(
        z.strictObject({
          fullName: z.string().trim().min(1).max(MAX_IMPORT_NAME_LENGTH),
          email: z.preprocess(
            blankToNull,
            z.email().max(MAX_IMPORT_EMAIL_LENGTH).nullable().default(null),
          ),
          phone: z.preprocess(
            blankToNull,
            z.string().trim().max(MAX_IMPORT_PHONE_LENGTH).nullable().default(null),
          ),
          level: z.preprocess(blankToNull, z.enum(CLIENT_LEVELS).nullable().default(null)),
        }),
      )
      .min(1)
      .max(MAX_IMPORT_ROWS),
  }),
) {}

export class ImportClientsResponseDto extends createZodDto(
  z.strictObject({
    createdCount: z.number().int(),
    updatedCount: z.number().int(),
    /** Filas que no se importaron, con su número de fila (la primera de datos es la 1). */
    skipped: z.array(
      z.strictObject({
        rowNumber: z.number().int(),
        email: z.string().nullable(),
        reason: z.enum([
          'missing_email',
          'duplicated_in_file',
          'blocked',
          'team_member',
          'client_limit_reached',
        ]),
      }),
    ),
  }),
) {}
