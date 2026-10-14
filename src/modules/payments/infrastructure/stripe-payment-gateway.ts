import { z } from 'zod';
import {
  type ConnectedAccountState,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type GatewayWebhookEvent,
  type NewGatewayPayment,
  type PaymentGateway,
} from '../application/ports/payment-gateway';
import { isValidStripeSignature } from './stripe-signature';

const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const PAYMENT_CURRENCY = 'eur';

export interface StripeGatewayConfig {
  readonly secretKey: string;
  /** `null` mientras no exista el webhook en Stripe: los avisos se rechazan. */
  readonly webhookSecret: string | null;
  readonly publishableKey: string;
  readonly returnUrl: string;
  readonly refreshUrl: string;
}

const accountSchema = z.object({
  id: z.string(),
  charges_enabled: z.boolean(),
  details_submitted: z.boolean(),
});

const accountLinkSchema = z.object({ url: z.url() });

const paymentIntentSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number().int(),
  client_secret: z.string(),
  metadata: z.record(z.string(), z.string()).default({}),
});

const webhookEventSchema = z.object({
  type: z.string(),
  data: z.object({ object: z.object({ id: z.string().optional() }) }),
});

function toGatewayStatus(stripeStatus: string): GatewayPaymentStatus {
  if (stripeStatus === 'succeeded') return 'succeeded';
  return stripeStatus === 'canceled' ? 'failed' : 'pending';
}

/** Los campos anidados de Stripe van como `metadata[centerId]=...` en un formulario. */
function encodeForm(fields: Readonly<Record<string, string>>): URLSearchParams {
  return new URLSearchParams(Object.entries(fields));
}

function prefixKeys(
  prefix: string,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`${prefix}[${key}]`, value]),
  );
}

interface StripeRequest<TSchema extends z.ZodType> {
  method: 'GET' | 'POST';
  path: string;
  schema: TSchema;
  fields?: Readonly<Record<string, string>>;
  idempotencyKey?: string;
}

/** Stripe Connect sobre su API HTTP: sin SDK, solo las cuatro llamadas que se necesitan. */
export class StripePaymentGateway implements PaymentGateway {
  constructor(private readonly config: StripeGatewayConfig) {}

  get publishableKey(): string {
    return this.config.publishableKey;
  }

  async createConnectedAccount(input: {
    centerId: string;
    businessName: string;
    contactEmail: string | null;
  }): Promise<{ accountId: string }> {
    const account = await this.send({
      method: 'POST',
      path: '/accounts',
      schema: accountSchema,
      fields: {
        type: 'express',
        country: 'ES',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
        'business_profile[name]': input.businessName,
        ...(input.contactEmail === null ? {} : { email: input.contactEmail }),
        ...prefixKeys('metadata', { centerId: input.centerId }),
      },
    });
    return { accountId: account.id };
  }

  async createOnboardingLink(accountId: string): Promise<{ url: string }> {
    const link = await this.send({
      method: 'POST',
      path: '/account_links',
      schema: accountLinkSchema,
      fields: {
        account: accountId,
        type: 'account_onboarding',
        return_url: this.config.returnUrl,
        refresh_url: this.config.refreshUrl,
      },
    });
    return { url: link.url };
  }

  async readConnectedAccount(accountId: string): Promise<ConnectedAccountState> {
    const account = await this.send({
      method: 'GET',
      path: `/accounts/${accountId}`,
      schema: accountSchema,
    });
    return { canCharge: account.charges_enabled, hasSubmittedDetails: account.details_submitted };
  }

  async createPayment(input: NewGatewayPayment): Promise<GatewayPayment> {
    const intent = await this.send({
      method: 'POST',
      path: '/payment_intents',
      schema: paymentIntentSchema,
      idempotencyKey: input.idempotencyKey,
      fields: {
        amount: String(input.amountCents),
        currency: PAYMENT_CURRENCY,
        description: input.description,
        'automatic_payment_methods[enabled]': 'true',
        // El dinero va a la cuenta del centro; Yoclick no cobra comisión por venta.
        'transfer_data[destination]': input.accountId,
        ...prefixKeys('metadata', input.metadata),
      },
    });
    return this.toGatewayPayment(intent);
  }

  async readPayment(paymentIntentId: string): Promise<GatewayPayment> {
    const intent = await this.send({
      method: 'GET',
      path: `/payment_intents/${paymentIntentId}`,
      schema: paymentIntentSchema,
    });
    return this.toGatewayPayment(intent);
  }

  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    now: Date;
  }): GatewayWebhookEvent | null {
    if (this.config.webhookSecret === null) return null;
    const isValid = isValidStripeSignature({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      secret: this.config.webhookSecret,
      now: input.now,
    });
    if (!isValid) return null;
    const parsed = webhookEventSchema.safeParse(JSON.parse(input.rawBody.toString('utf8')));
    if (!parsed.success) return null;
    const isPaymentEvent = parsed.data.type.startsWith('payment_intent.');
    return {
      type: parsed.data.type,
      paymentIntentId: isPaymentEvent ? (parsed.data.data.object.id ?? null) : null,
    };
  }

  private toGatewayPayment(intent: z.infer<typeof paymentIntentSchema>): GatewayPayment {
    return {
      paymentIntentId: intent.id,
      status: toGatewayStatus(intent.status),
      amountCents: intent.amount,
      clientSecret: intent.client_secret,
      metadata: intent.metadata,
    };
  }

  private async send<TSchema extends z.ZodType>(
    request: StripeRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const { method, path, fields, idempotencyKey } = request;
    const response = await fetch(`${STRIPE_API_BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        ...(fields === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
        ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
      },
      ...(fields === undefined ? {} : { body: encodeForm(fields) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Stripe ${method} ${path} failed with status ${String(response.status)}`);
    }
    return request.schema.parse(await response.json());
  }
}
