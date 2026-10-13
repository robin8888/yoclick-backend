import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  MAX_RATE_NAME_LENGTH,
  MAX_RATE_PRICE_CENTS,
  MAX_RATE_SERVICES,
  MAX_RATE_SESSIONS,
  MAX_RATE_VALID_DAYS,
  MIN_RATE_NAME_LENGTH,
  MIN_RATE_SESSIONS,
  MIN_RATE_VALID_DAYS,
} from '../domain/pass-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class RateRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), rateId: z.uuid() }),
) {}

export class PassRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), passId: z.uuid() }),
) {}

const serviceShape = z.strictObject({ id: z.uuid(), name: z.string() });

const rateShape = {
  id: z.uuid(),
  name: z.string(),
  /** Clases que trae el bono. */
  sessionsCount: z.number().int(),
  /** Días que dura desde que se activa. */
  validDays: z.number().int(),
  priceCents: z.number().int(),
  /** Servicios en los que vale; vacío = todos. */
  services: z.array(serviceShape),
};

export class RateResponseDto extends createZodDto(z.strictObject(rateShape)) {}
export class RateListResponseDto extends createZodDto(
  z.strictObject({ rates: z.array(z.strictObject(rateShape)) }),
) {}

const rateFields = {
  name: z.string().trim().min(MIN_RATE_NAME_LENGTH).max(MAX_RATE_NAME_LENGTH),
  sessionsCount: z.number().int().min(MIN_RATE_SESSIONS).max(MAX_RATE_SESSIONS),
  validDays: z.number().int().min(MIN_RATE_VALID_DAYS).max(MAX_RATE_VALID_DAYS),
  priceCents: z.number().int().min(0).max(MAX_RATE_PRICE_CENTS),
  /** Servicios en los que vale; vacío = todos. */
  serviceIds: z.array(z.uuid()).max(MAX_RATE_SERVICES),
};

export class CreateRateRequestDto extends createZodDto(
  z.strictObject({ ...rateFields, serviceIds: rateFields.serviceIds.default([]) }),
) {}

export class UpdateRateRequestDto extends createZodDto(
  z.strictObject({
    name: rateFields.name.optional(),
    sessionsCount: rateFields.sessionsCount.optional(),
    validDays: rateFields.validDays.optional(),
    priceCents: rateFields.priceCents.optional(),
    serviceIds: rateFields.serviceIds.optional(),
  }),
) {}

const passShape = {
  id: z.uuid(),
  name: z.string(),
  /** «agotado» y «caducado» se calculan: no hace falta que nadie los marque. */
  status: z.enum(['pending', 'active', 'exhausted', 'expired', 'rejected']),
  totalSessions: z.number().int(),
  remainingSessions: z.number().int(),
  priceCents: z.number().int(),
  services: z.array(serviceShape),
  /** La persona lo pidió desde la app (true) o el centro se lo asignó (false). */
  isRequestedByClient: z.boolean(),
  requestedAt: z.iso.datetime(),
  startsAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  client: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }),
};

export class PassResponseDto extends createZodDto(z.strictObject(passShape)) {}
export class PassListResponseDto extends createZodDto(
  z.strictObject({ passes: z.array(z.strictObject(passShape)) }),
) {}

export class PassListQueryDto extends createZodDto(
  z.strictObject({
    status: z.enum(['pending', 'active', 'exhausted', 'expired', 'rejected']).optional(),
    clientMembershipId: z.uuid().optional(),
  }),
) {}

export class EligibleClientsQueryDto extends createZodDto(
  z.strictObject({ serviceId: z.uuid() }),
) {}

export class EligibleClientsResponseDto extends createZodDto(
  z.strictObject({
    clients: z.array(
      z.strictObject({
        membershipId: z.uuid(),
        fullName: z.string(),
        /** Clases que aún se le pueden apuntar: lo que le queda menos lo ya agendado. */
        bookableSessions: z.number().int(),
      }),
    ),
  }),
) {}

export class AssignPassRequestDto extends createZodDto(
  z.strictObject({ rateId: z.uuid(), clientMembershipId: z.uuid() }),
) {}
