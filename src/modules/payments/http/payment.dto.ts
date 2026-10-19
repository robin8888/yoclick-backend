import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class PassPaymentRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), passId: z.uuid() }),
) {}

export class PaymentRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), paymentId: z.uuid() }),
) {}

export class PaymentsStatusResponseDto extends createZodDto(
  z.strictObject({
    /** `not_included`: el plan no cobra online; el resto, el avance del alta de cobros en Stripe. */
    status: z.enum(['not_included', 'not_started', 'pending', 'ready']),
    /** Razón social, NIF y dirección fiscal rellenos: sin ellos no se puede cobrar online. */
    isFiscalDataComplete: z.boolean(),
  }),
) {}

export class PaymentListResponseDto extends createZodDto(
  z.strictObject({
    payments: z.array(
      z.strictObject({
        id: z.uuid(),
        kind: z.literal('pass'),
        /** El bono que se pagó. */
        label: z.string(),
        clientName: z.string(),
        amountCents: z.number().int(),
        /** Lo devuelto desde el panel de Stripe del centro; igual a `amountCents` si fue total. */
        refundedCents: z.number().int(),
        /** `2026-000001`; el recibo existe una vez pagado. */
        receiptNumber: z.string().nullable(),
        status: z.enum(['pending', 'succeeded', 'failed']),
        createdAt: z.iso.datetime(),
        paidAt: z.iso.datetime().nullable(),
      }),
    ),
  }),
) {}

export class OnboardingLinkResponseDto extends createZodDto(z.strictObject({ url: z.url() })) {}

export class PaymentSheetResponseDto extends createZodDto(
  z.strictObject({
    paymentId: z.uuid(),
    /** Secreto del cobro para abrir la hoja de pago de Stripe; solo lo recibe quien paga. */
    clientSecret: z.string(),
    publishableKey: z.string(),
    /** Cuenta del centro en la que vive el cobro: la hoja de pago de Stripe debe abrirse en ella. */
    connectedAccountId: z.string(),
    amountCents: z.number().int(),
    /** El nombre del centro, que ve quien paga en la hoja. */
    merchantName: z.string(),
  }),
) {}

export class PaymentConfirmationResponseDto extends createZodDto(
  z.strictObject({
    paymentId: z.uuid(),
    status: z.enum(['succeeded', 'pending', 'failed']),
  }),
) {}

/** Un recibo: los precios llevan el IVA incluido, así que `totalCents = baseCents + vatCents`. */
export class ReceiptResponseDto extends createZodDto(
  z.strictObject({
    receiptNumber: z.string(),
    issuedAt: z.iso.datetime(),
    seller: z.strictObject({
      legalName: z.string(),
      taxId: z.string().nullable(),
      taxAddress: z.string().nullable(),
    }),
    buyerName: z.string(),
    concept: z.string(),
    baseCents: z.number().int(),
    /** Porcentaje de IVA aplicado (21). */
    vatRatePercent: z.number().int(),
    vatCents: z.number().int(),
    totalCents: z.number().int(),
    refundedCents: z.number().int(),
  }),
) {}
