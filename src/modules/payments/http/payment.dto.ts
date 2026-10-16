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
