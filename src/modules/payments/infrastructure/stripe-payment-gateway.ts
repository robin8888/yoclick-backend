import { Logger } from '@nestjs/common';
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

const STRIPE_API_ORIGIN = 'https://api.stripe.com';
/** Versión de la API con la que se habla a Accounts v2 (cuentas conectadas y sus enlaces). */
const STRIPE_V2_API_VERSION = '2026-09-30.endive';
const V1_ACCOUNT_IN_V2_ERROR_CODE = 'v1_account_instead_of_v2_account';
const REQUEST_TIMEOUT_MS = 15_000;
const PAYMENT_CURRENCY = 'eur';

export interface StripeGatewayConfig {
  readonly secretKey: string;
  /**
   * Secretos de los webhooks de Stripe: el de cuenta de la plataforma y el de eventos Connect (los
   * cobros directos se avisan por este último). Vacío mientras no exista el webhook: se rechazan.
   */
  readonly webhookSecrets: readonly string[];
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
const createdAccountSchema = z.object({ id: z.string() });

const paymentIntentSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number().int(),
  client_secret: z.string(),
  metadata: z.record(z.string(), z.string()).default({}),
});

const webhookEventSchema = z.object({
  type: z.string(),
  /** Presente en los eventos Connect: la cuenta del centro en la que ocurrió. */
  account: z.string().optional(),
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

const stripeErrorSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }),
});

/** Fallo devuelto por Stripe; `stripeCode` permite reaccionar sin comparar textos. */
class StripeApiError extends Error {
  constructor(
    message: string,
    readonly stripeCode: string | null,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

interface StripeFailure {
  readonly code: string | null;
  readonly message: string;
}

/** Motivo que da Stripe (sin cuerpo de petición ni claves) para poder diagnosticar el fallo. */
async function readStripeFailure(response: Response): Promise<StripeFailure> {
  const parsed = stripeErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { code: null, message: 'unknown reason' };
  const { code, message } = parsed.data.error;
  return { code: code ?? null, message: message ?? 'no message' };
}

interface StripeRequest<TSchema extends z.ZodType> {
  method: 'GET' | 'POST';
  path: string;
  schema: TSchema;
  fields?: Readonly<Record<string, string>>;
  idempotencyKey?: string;
  /** Opera en nombre de la cuenta del centro (cobros directos). */
  stripeAccountId?: string;
}

interface StripeJsonRequest<TSchema extends z.ZodType> {
  method: 'POST';
  path: string;
  schema: TSchema;
  body: Readonly<Record<string, unknown>>;
}

/** Stripe Connect sobre su API HTTP: sin SDK, solo las cuatro llamadas que se necesitan. */
export class StripePaymentGateway implements PaymentGateway {
  private readonly logger = new Logger(StripePaymentGateway.name);

  constructor(private readonly config: StripeGatewayConfig) {}

  get publishableKey(): string {
    return this.config.publishableKey;
  }

  async createConnectedAccount(input: {
    centerId: string;
    businessName: string;
    contactEmail: string | null;
  }): Promise<{ accountId: string }> {
    const account = await this.sendJson({
      method: 'POST',
      path: '/core/accounts',
      schema: createdAccountSchema,
      body: {
        display_name: input.businessName,
        ...(input.contactEmail === null ? {} : { contact_email: input.contactEmail }),
        identity: { country: 'ES' },
        dashboard: 'express',
        defaults: {
          responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
        },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        metadata: { centerId: input.centerId },
      },
    });
    return { accountId: account.id };
  }

  async createOnboardingLink(accountId: string): Promise<{ url: string }> {
    try {
      return await this.createOnboardingLinkV2(accountId);
    } catch (error) {
      // Las cuentas creadas antes de Accounts v2 solo admiten el enlace v1.
      const isLegacyAccount =
        error instanceof StripeApiError && error.stripeCode === V1_ACCOUNT_IN_V2_ERROR_CODE;
      if (!isLegacyAccount) throw error;
      return this.createOnboardingLinkV1(accountId);
    }
  }

  private async createOnboardingLinkV2(accountId: string): Promise<{ url: string }> {
    const link = await this.sendJson({
      method: 'POST',
      path: '/core/account_links',
      schema: accountLinkSchema,
      body: {
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            return_url: this.config.returnUrl,
            refresh_url: this.config.refreshUrl,
          },
        },
      },
    });
    return { url: link.url };
  }

  private async createOnboardingLinkV1(accountId: string): Promise<{ url: string }> {
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
      stripeAccountId: input.accountId,
      fields: {
        amount: String(input.amountCents),
        currency: PAYMENT_CURRENCY,
        description: input.description,
        'automatic_payment_methods[enabled]': 'true',
        ...prefixKeys('metadata', input.metadata),
      },
    });
    return this.toGatewayPayment(intent);
  }

  async readPayment(input: {
    paymentIntentId: string;
    accountId: string;
  }): Promise<GatewayPayment> {
    const intent = await this.send({
      method: 'GET',
      path: `/payment_intents/${input.paymentIntentId}`,
      schema: paymentIntentSchema,
      stripeAccountId: input.accountId,
    });
    return this.toGatewayPayment(intent);
  }

  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    now: Date;
  }): GatewayWebhookEvent | null {
    const isValid = this.config.webhookSecrets.some((secret) =>
      isValidStripeSignature({
        rawBody: input.rawBody,
        signatureHeader: input.signatureHeader,
        secret,
        now: input.now,
      }),
    );
    if (!isValid) return null;
    const parsed = webhookEventSchema.safeParse(JSON.parse(input.rawBody.toString('utf8')));
    if (!parsed.success) return null;
    const isPaymentEvent = parsed.data.type.startsWith('payment_intent.');
    return {
      type: parsed.data.type,
      paymentIntentId: isPaymentEvent ? (parsed.data.data.object.id ?? null) : null,
      accountId: parsed.data.account ?? null,
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
    const { method, path, fields, idempotencyKey, stripeAccountId } = request;
    return this.call({
      method,
      url: `${STRIPE_API_ORIGIN}/v1${path}`,
      schema: request.schema,
      headers: {
        ...(fields === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
        ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
        ...(stripeAccountId === undefined ? {} : { 'stripe-account': stripeAccountId }),
      },
      ...(fields === undefined ? {} : { body: encodeForm(fields) }),
    });
  }

  /** Accounts v2: cuerpo JSON y versión de API explícita. */
  private async sendJson<TSchema extends z.ZodType>(
    request: StripeJsonRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    return this.call({
      method: request.method,
      url: `${STRIPE_API_ORIGIN}/v2${request.path}`,
      schema: request.schema,
      headers: { 'content-type': 'application/json', 'stripe-version': STRIPE_V2_API_VERSION },
      body: JSON.stringify(request.body),
    });
  }

  private async call<TSchema extends z.ZodType>(input: {
    method: 'GET' | 'POST';
    url: string;
    schema: TSchema;
    headers: Readonly<Record<string, string>>;
    body?: URLSearchParams | string;
  }): Promise<z.infer<TSchema>> {
    const response = await fetch(input.url, {
      method: input.method,
      headers: { authorization: `Bearer ${this.config.secretKey}`, ...input.headers },
      ...(input.body === undefined ? {} : { body: input.body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await this.toApiError(input, response);
    return input.schema.parse(await response.json());
  }

  private async toApiError(
    input: { method: string; url: string },
    response: Response,
  ): Promise<StripeApiError> {
    const failure = await readStripeFailure(response);
    const path = new URL(input.url).pathname;
    const summary = `Stripe ${input.method} ${path} failed with status ${String(response.status)}`;
    const message = `${summary}: ${failure.code ?? 'no_code'} - ${failure.message}`;
    this.logger.error(message);
    return new StripeApiError(message, failure.code);
  }
}
