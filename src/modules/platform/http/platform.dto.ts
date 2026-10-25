import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { paginationQueryShape } from '../../../shared/pagination/pagination-query.schema';
import { SECTOR_IDS } from '../../onboarding/http/create-center.dto';

const CENTER_STATUSES = ['trial', 'active', 'past_due', 'suspended'] as const;
const MAX_SEARCH_LENGTH = 80;
const MAX_CLIENT_LIMIT = 1_000_000;
const PLAN_IDS = ['basic', 'pro', 'premium'] as const;
const MAX_PLAN_PRICE_CENTS = 1_000_000;

export class PlatformCenterRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid() }),
) {}

export class PlatformCentersQueryDto extends createZodDto(
  z.strictObject({
    ...paginationQueryShape,
    status: z.enum(CENTER_STATUSES).optional(),
    sectorId: z.enum(SECTOR_IDS).optional(),
    search: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
  }),
) {}

export class PlatformAuditQueryDto extends createZodDto(
  z.strictObject({ ...paginationQueryShape, centerId: z.uuid().optional() }),
) {}

/** Lo que la plataforma puede cambiar de un centro; hace falta al menos un campo. */
export class UpdatePlatformCenterRequestDto extends createZodDto(
  z
    .strictObject({
      status: z.enum(CENTER_STATUSES).optional(),
      /** Nueva fecha de fin de la prueba (en el futuro) o `null` para quitarla. */
      trialEndsAt: z.iso.datetime().nullable().optional(),
      /** Plan del centro: se copian al centro los límites del plan (clientes, documentos, vídeo). */
      planId: z.enum(PLAN_IDS).optional(),
      /** Tope de clientes activos; `null` = sin tope. */
      maxClients: z.number().int().min(0).max(MAX_CLIENT_LIMIT).nullable().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' }),
) {}

const monthlyCountShape = z.strictObject({ month: z.string(), count: z.number().int() });

export class PlatformOverviewResponseDto extends createZodDto(
  z.strictObject({
    generatedAt: z.iso.datetime(),
    centers: z.strictObject({
      total: z.number().int(),
      byStatus: z.strictObject({
        trial: z.number().int(),
        active: z.number().int(),
        past_due: z.number().int(),
        suspended: z.number().int(),
      }),
      newLast30Days: z.number().int(),
      trialsEndingWithin7Days: z.number().int(),
    }),
    people: z.strictObject({
      activeClients: z.number().int(),
      activeTeamMembers: z.number().int(),
    }),
    bookingsLast30Days: z.number().int(),
    monthly: z.strictObject({
      newCenters: z.array(monthlyCountShape),
      bookings: z.array(monthlyCountShape),
    }),
    centersBySector: z.array(z.strictObject({ sectorId: z.string(), count: z.number().int() })),
  }),
) {}

const centerSummaryShape = {
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  sectorId: z.string(),
  city: z.string().nullable(),
  /** Ruta del logo del centro (se completa con el origen de la API); `null` si no tiene. */
  logoUrl: z.string().nullable(),
  status: z.enum(CENTER_STATUSES),
  planId: z.enum(PLAN_IDS),
  createdAt: z.iso.datetime(),
  trialEndsAt: z.iso.datetime().nullable(),
  maxClients: z.number().int().nullable(),
  activeClientCount: z.number().int(),
  teamMemberCount: z.number().int(),
  bookingsLast30Days: z.number().int(),
  lastBookingAt: z.iso.datetime().nullable(),
};

export class PlatformCenterListResponseDto extends createZodDto(
  z.strictObject({
    data: z.array(z.strictObject(centerSummaryShape)),
    nextCursor: z.string().nullable(),
  }),
) {}

export class PlatformCenterDetailResponseDto extends createZodDto(
  z.strictObject({
    ...centerSummaryShape,
    timezone: z.string(),
    disabledModules: z.array(z.string()),
    stripeChargesEnabled: z.boolean(),
    documentStorageLimitBytes: z.number().int(),
    videoStorageLimitBytes: z.number().int().nullable(),
    photoStorageLimitBytes: z.number().int(),
  }),
) {}

export class PlatformAuditListResponseDto extends createZodDto(
  z.strictObject({
    data: z.array(
      z.strictObject({
        id: z.uuid(),
        action: z.string(),
        centerId: z.uuid().nullable(),
        details: z.record(z.string(), z.unknown()),
        createdAt: z.iso.datetime(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
) {}

export class PlatformPlanRouteParamsDto extends createZodDto(
  z.strictObject({ planId: z.enum(PLAN_IDS) }),
) {}

const priceCentsShape = z.number().int().min(0).max(MAX_PLAN_PRICE_CENTS);

/** Importes en céntimos, sin IVA; hace falta al menos uno. */
export class UpdatePlatformPlanRequestDto extends createZodDto(
  z
    .strictObject({
      monthlyPriceCents: priceCentsShape.optional(),
      /** Precio por mes pagando el año entero; no puede superar al mensual. */
      annualMonthlyPriceCents: priceCentsShape.optional(),
      /** Cuota de alta, una sola vez, en la primera factura. */
      setupFeeCents: priceCentsShape.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' }),
) {}

const planShape = {
  id: z.enum(PLAN_IDS),
  name: z.string(),
  monthlyPriceCents: z.number().int(),
  annualMonthlyPriceCents: z.number().int(),
  setupFeeCents: z.number().int(),
  maxClients: z.number().int().nullable(),
  documentStorageLimitBytes: z.number().int(),
  videoStorageLimitBytes: z.number().int().nullable(),
  /** Centros de este plan por estado. */
  centerCountByStatus: z.strictObject({
    trial: z.number().int(),
    active: z.number().int(),
    past_due: z.number().int(),
    suspended: z.number().int(),
  }),
};

export class PlatformPlanResponseDto extends createZodDto(z.strictObject(planShape)) {}

export class PlatformPlanListResponseDto extends createZodDto(
  z.strictObject({
    plans: z.array(z.strictObject(planShape)),
    /** Ingresos recurrentes al mes, sin IVA, de los centros que pagan (activos y en gracia). */
    monthlyRecurringRevenueCents: z.number().int(),
  }),
) {}
