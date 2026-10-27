import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { paginationQueryShape } from '../../../shared/pagination/pagination-query.schema';

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_CONCEPT_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 60;
const MAX_LEGAL_NAME_LENGTH = 200;
const MAX_TAX_ID_LENGTH = 20;
const MAX_CHARGE_CENTS = 100_000_000;
const MAX_BASIS_POINTS = 10_000;
const CHARGE_STATUSES = ['pending', 'paid', 'void'] as const;
const PAYMENT_METHODS = ['transfer', 'card', 'cash', 'other'] as const;

const monthKeyShape = z.string().regex(MONTH_KEY_PATTERN);

export class PlatformChargeRouteParamsDto extends createZodDto(
  z.strictObject({ chargeId: z.uuid() }),
) {}

export class PlatformChargesQueryDto extends createZodDto(
  z.strictObject({
    ...paginationQueryShape,
    /** Mes natural `YYYY-MM`. */
    month: monthKeyShape.optional(),
    centerId: z.uuid().optional(),
  }),
) {}

export class PlatformChargeReportQueryDto extends createZodDto(
  z.strictObject({ fromMonth: monthKeyShape, toMonth: monthKeyShape }),
) {}

const optionalTextShape = (maxLength: number): z.ZodOptional<z.ZodNullable<z.ZodString>> =>
  z.string().trim().min(1).max(maxLength).nullable().optional();

/** Apunta un cobro de plan a mano. La cuota de IVA y el total los calcula el servidor. */
export class RecordPlatformChargeRequestDto extends createZodDto(
  z.strictObject({
    centerId: z.uuid(),
    /** Día del cobro `YYYY-MM-DD`; no puede ser futuro. */
    chargedOn: z.iso.date(),
    concept: z.string().trim().min(1).max(MAX_CONCEPT_LENGTH),
    /** Base imponible en céntimos, sin IVA. */
    baseCents: z.number().int().min(0).max(MAX_CHARGE_CENTS),
    /** Tipo de IVA en puntos básicos: 2100 es el 21 %. */
    vatBasisPoints: z.number().int().min(0).max(MAX_BASIS_POINTS),
    status: z.enum(CHARGE_STATUSES).default('paid'),
    paymentMethod: z.enum(PAYMENT_METHODS),
    invoiceReference: optionalTextShape(MAX_REFERENCE_LENGTH),
    customerLegalName: optionalTextShape(MAX_LEGAL_NAME_LENGTH),
    customerTaxId: optionalTextShape(MAX_TAX_ID_LENGTH),
  }),
) {}

export class UpdatePlatformChargeRequestDto extends createZodDto(
  z
    .strictObject({
      status: z.enum(CHARGE_STATUSES).optional(),
      invoiceReference: z.string().trim().min(1).max(MAX_REFERENCE_LENGTH).nullable().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' }),
) {}

const chargeShape = {
  id: z.uuid(),
  centerId: z.uuid(),
  centerName: z.string(),
  chargedOn: z.iso.date(),
  concept: z.string(),
  baseCents: z.number().int(),
  vatBasisPoints: z.number().int(),
  vatCents: z.number().int(),
  totalCents: z.number().int(),
  stripeFeeCents: z.number().int().nullable(),
  status: z.enum(CHARGE_STATUSES),
  source: z.enum(['manual', 'stripe']),
  paymentMethod: z.enum(PAYMENT_METHODS),
  invoiceReference: z.string().nullable(),
  stripeId: z.string().nullable(),
  customerLegalName: z.string().nullable(),
  customerTaxId: z.string().nullable(),
  createdAt: z.iso.datetime(),
};

export class PlatformChargeResponseDto extends createZodDto(z.strictObject(chargeShape)) {}

export class PlatformChargeListResponseDto extends createZodDto(
  z.strictObject({
    data: z.array(z.strictObject(chargeShape)),
    nextCursor: z.string().nullable(),
  }),
) {}

const chargeTotalsShape = {
  baseCents: z.number().int(),
  vatCents: z.number().int(),
  totalCents: z.number().int(),
  chargeCount: z.number().int(),
  stripeFeeCents: z.number().int(),
};

export class PlatformChargeReportResponseDto extends createZodDto(
  z.strictObject({
    months: z.array(z.strictObject({ month: z.string(), ...chargeTotalsShape })),
    totals: z.strictObject(chargeTotalsShape),
  }),
) {}
