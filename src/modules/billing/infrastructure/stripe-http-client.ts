import { Logger } from '@nestjs/common';
import { z } from 'zod';

const STRIPE_API_ORIGIN = 'https://api.stripe.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const HTTP_NOT_FOUND = 404;

const stripeErrorSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }),
});

/** Fallo devuelto por Stripe; `stripeCode` permite reaccionar sin comparar textos. */
export class StripeRequestError extends Error {
  constructor(
    message: string,
    readonly stripeCode: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = 'StripeRequestError';
  }

  get isMissingResource(): boolean {
    return this.status === HTTP_NOT_FOUND || this.stripeCode === 'resource_missing';
  }
}

export type StripeFields = Readonly<Record<string, string>>;

/** El cliente HTTP mínimo de Stripe para la facturación: formularios, clave secreta y errores legibles. */
export class StripeHttpClient {
  private readonly logger = new Logger(StripeHttpClient.name);

  constructor(private readonly secretKey: string) {}

  get<TSchema extends z.ZodType>(path: string, schema: TSchema): Promise<z.infer<TSchema>> {
    return this.call({ method: 'GET', path, schema });
  }

  post<TSchema extends z.ZodType>(input: {
    path: string;
    fields: StripeFields;
    schema: TSchema;
    idempotencyKey?: string;
  }): Promise<z.infer<TSchema>> {
    return this.call({ method: 'POST', ...input });
  }

  private async call<TSchema extends z.ZodType>(input: {
    method: 'GET' | 'POST';
    path: string;
    schema: TSchema;
    fields?: StripeFields;
    idempotencyKey?: string;
  }): Promise<z.infer<TSchema>> {
    const response = await fetch(`${STRIPE_API_ORIGIN}${input.path}`, {
      method: input.method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        ...(input.fields === undefined
          ? {}
          : { 'content-type': 'application/x-www-form-urlencoded' }),
        ...(input.idempotencyKey === undefined ? {} : { 'idempotency-key': input.idempotencyKey }),
      },
      ...(input.fields === undefined
        ? {}
        : { body: new URLSearchParams(Object.entries(input.fields)) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await this.toError(input, response);
    return input.schema.parse(await response.json());
  }

  private async toError(
    input: { method: string; path: string },
    response: Response,
  ): Promise<StripeRequestError> {
    const parsed = stripeErrorSchema.safeParse(await response.json().catch(() => null));
    const code = parsed.success ? (parsed.data.error.code ?? null) : null;
    const reason = parsed.success ? (parsed.data.error.message ?? 'no message') : 'unknown reason';
    // Sin el cuerpo de la petición ni las claves: solo qué llamada falló y el motivo que da Stripe.
    const path = input.path.split('?')[0] ?? input.path;
    const message = `Stripe ${input.method} ${path} failed with status ${String(response.status)}: ${code ?? 'no_code'} - ${reason}`;
    // Buscar algo que aún no existe (un producto antes de crearlo) no es un fallo.
    if (response.status === HTTP_NOT_FOUND) this.logger.warn(message);
    else this.logger.error(message);
    return new StripeRequestError(message, code, response.status);
  }
}
