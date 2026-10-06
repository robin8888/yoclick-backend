import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  isValidServiceDuration,
  MAX_BOOKING_WINDOW_DAYS,
  MAX_MIN_NOTICE_MINUTES,
  MAX_SERVICE_DESCRIPTION_LENGTH,
  MAX_SERVICE_NAME_LENGTH,
  MAX_SERVICE_PRICE_CENTS,
  MAX_STAFF_PER_SERVICE,
  MIN_BOOKING_WINDOW_DAYS,
  MIN_SERVICE_NAME_LENGTH,
  SERVICE_COLOR_PATTERN,
} from '../domain/service-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class ServiceRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), serviceId: z.uuid() }),
) {}

const serviceStaffShape = { membershipId: z.uuid(), fullName: z.string() };

const serviceShape = {
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.literal('individual'),
  durationMinutes: z.number().int(),
  /** En céntimos; `null` = «a consultar». */
  priceCents: z.number().int().nullable(),
  currency: z.literal('EUR'),
  color: z.string().nullable(),
  bookingWindowDays: z.number().int(),
  minNoticeMinutes: z.number().int(),
  isVisible: z.boolean(),
  /** Sala o recurso donde se da; `null` = sin sala fija. */
  room: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  staff: z.array(z.strictObject(serviceStaffShape)),
};

export class ServiceResponseDto extends createZodDto(z.strictObject(serviceShape)) {}
export class ServiceListResponseDto extends createZodDto(
  z.strictObject({ services: z.array(z.strictObject(serviceShape)) }),
) {}

const nameSchema = z.string().trim().min(MIN_SERVICE_NAME_LENGTH).max(MAX_SERVICE_NAME_LENGTH);
const descriptionSchema = z.string().trim().min(1).max(MAX_SERVICE_DESCRIPTION_LENGTH);
const durationSchema = z
  .number()
  .int()
  .refine(isValidServiceDuration, 'between 15 and 480 minutes, in steps of 5');
const priceSchema = z.number().int().min(0).max(MAX_SERVICE_PRICE_CENTS);
const colorSchema = z
  .string()
  .regex(SERVICE_COLOR_PATTERN)
  .transform((color) => color.toUpperCase());
const bookingWindowSchema = z
  .number()
  .int()
  .min(MIN_BOOKING_WINDOW_DAYS)
  .max(MAX_BOOKING_WINDOW_DAYS);
const minNoticeSchema = z.number().int().min(0).max(MAX_MIN_NOTICE_MINUTES);
const staffIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(MAX_STAFF_PER_SERVICE)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicated');

export class CreateServiceRequestDto extends createZodDto(
  z.strictObject({
    name: nameSchema,
    description: descriptionSchema.optional(),
    durationMinutes: durationSchema,
    priceCents: priceSchema.optional(),
    color: colorSchema.optional(),
    bookingWindowDays: bookingWindowSchema.optional(),
    minNoticeMinutes: minNoticeSchema.optional(),
    isVisible: z.boolean().optional(),
    roomId: z.uuid().optional(),
    staffMembershipIds: staffIdsSchema.optional(),
  }),
) {}

/** Parcial: lo que no se envía no cambia, y `null` borra descripción, precio o color. */
export class UpdateServiceRequestDto extends createZodDto(
  z
    .strictObject({
      name: nameSchema.optional(),
      description: descriptionSchema.nullable().optional(),
      durationMinutes: durationSchema.optional(),
      priceCents: priceSchema.nullable().optional(),
      color: colorSchema.nullable().optional(),
      bookingWindowDays: bookingWindowSchema.optional(),
      minNoticeMinutes: minNoticeSchema.optional(),
      isVisible: z.boolean().optional(),
      roomId: z.uuid().nullable().optional(),
      staffMembershipIds: staffIdsSchema.optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, 'send at least one field to change'),
) {}
