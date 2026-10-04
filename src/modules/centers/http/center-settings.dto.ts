import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  areIntervalsConsistent,
  isValidTimeOfDay,
  isValidTimeZone,
  WEEKDAYS,
} from '../domain/opening-hours';

const MIN_CENTER_NAME_LENGTH = 2;
const MAX_CENTER_NAME_LENGTH = 80;
const MAX_TEXT_LENGTH = 200;
const MAX_INTERVALS_PER_DAY = 4;
const MAX_HOLIDAYS = 100;
const MAX_HOLIDAY_LABEL_LENGTH = 60;
const MAX_FREE_CANCELLATION_HOURS = 168;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
const MAX_TIME_ZONE_LENGTH = 64;

const timeOfDaySchema = z.string().refine(isValidTimeOfDay, 'expected HH:MM');

const dayIntervalsSchema = z
  .array(z.strictObject({ opensAt: timeOfDaySchema, closesAt: timeOfDaySchema }))
  .max(MAX_INTERVALS_PER_DAY)
  .refine(areIntervalsConsistent, 'intervals must open before they close and not overlap');

const openingHoursSchema = z.strictObject(
  Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, dayIntervalsSchema.optional()])) as Record<
    (typeof WEEKDAYS)[number],
    z.ZodOptional<typeof dayIntervalsSchema>
  >,
);

const holidaySchema = z.strictObject({
  date: z.iso.date(),
  label: z.string().trim().min(1).max(MAX_HOLIDAY_LABEL_LENGTH),
});

const holidaysSchema = z
  .array(holidaySchema)
  .max(MAX_HOLIDAYS)
  .refine(
    (holidays) => new Set(holidays.map(({ date }) => date)).size === holidays.length,
    'a date can only be listed once',
  );

const cancelPolicySchema = z.strictObject({
  freeCancellationHours: z.number().int().min(0).max(MAX_FREE_CANCELLATION_HOURS),
  lateCancellationConsumesCredit: z.boolean(),
});

const centerSettingsShape = {
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  sectorId: z.string(),
  brandColor: z.string(),
  timezone: z.string(),
  /** Solo lo ve la administración. */
  joinCode: z.string(),
  status: z.enum(['trial', 'active', 'past_due', 'suspended']),
  isListed: z.boolean(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  openingHours: openingHoursSchema.nullable(),
  holidays: holidaysSchema.nullable(),
  cancelPolicy: cancelPolicySchema.nullable(),
  trialEndsAt: z.iso.datetime().nullable(),
};

export class CenterSettingsResponseDto extends createZodDto(z.strictObject(centerSettingsShape)) {}

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

const areCoordinatesTogether = (patch: { latitude?: unknown; longitude?: unknown }): boolean =>
  (patch.latitude === undefined) === (patch.longitude === undefined);

/** Solo lo editable. Cualquier otro campo (slug, estado, código, plan) se rechaza, no se ignora. */
export class UpdateCenterSettingsRequestDto extends createZodDto(
  z
    .strictObject({
      name: z.string().trim().min(MIN_CENTER_NAME_LENGTH).max(MAX_CENTER_NAME_LENGTH).optional(),
      brandColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .transform((color) => color.toUpperCase())
        .optional(),
      timezone: z
        .string()
        .max(MAX_TIME_ZONE_LENGTH)
        .refine(isValidTimeZone, 'unknown time zone')
        .optional(),
      isListed: z.boolean().optional(),
      city: z.string().trim().min(1).max(MAX_TEXT_LENGTH).nullable().optional(),
      address: z.string().trim().min(1).max(MAX_TEXT_LENGTH).nullable().optional(),
      latitude: z.number().min(-MAX_LATITUDE).max(MAX_LATITUDE).nullable().optional(),
      longitude: z.number().min(-MAX_LONGITUDE).max(MAX_LONGITUDE).nullable().optional(),
      openingHours: openingHoursSchema.optional(),
      holidays: holidaysSchema.optional(),
      cancelPolicy: cancelPolicySchema.optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, 'send at least one field to change')
    .refine(areCoordinatesTogether, 'latitude and longitude must be sent together'),
) {}
