import { v4 as generateUuidV4 } from 'uuid';
import {
  type ConnectedAccountState,
  type GatewayPayment,
  type GatewayWebhookEvent,
  type NewGatewayPayment,
  type PaymentGateway,
} from '../application/ports/payment-gateway';

const ID_SUFFIX_LENGTH = 8;

/**
 * Pasarela para desarrollo y tests: no llama a nadie. Una cuenta nace sin poder cobrar hasta que
 * `completeOnboarding` la marca (lo que en Stripe hace el propio centro); un cobro nace pendiente y
 * `succeed` lo da por pagado (lo que haría la hoja de pago).
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly publishableKey = 'pk_test_fake';
  private readonly chargeableAccounts = new Set<string>();
  private readonly payments = new Map<string, GatewayPayment>();
  private readonly paymentsByKey = new Map<string, string>();

  createConnectedAccount(): Promise<{ accountId: string }> {
    return Promise.resolve({
      accountId: `acct_fake_${generateUuidV4().slice(0, ID_SUFFIX_LENGTH)}`,
    });
  }

  createOnboardingLink(accountId: string): Promise<{ url: string }> {
    return Promise.resolve({ url: `https://connect.fake.local/onboarding/${accountId}` });
  }

  createDashboardLink(accountId: string): Promise<{ url: string }> {
    return Promise.resolve({ url: `https://connect.fake.local/dashboard/${accountId}` });
  }

  readConnectedAccount(accountId: string): Promise<ConnectedAccountState> {
    const canCharge = this.chargeableAccounts.has(accountId);
    return Promise.resolve({ canCharge, hasSubmittedDetails: canCharge });
  }

  createPayment(input: NewGatewayPayment): Promise<GatewayPayment> {
    const existingId = this.paymentsByKey.get(input.idempotencyKey);
    const existing = existingId === undefined ? undefined : this.payments.get(existingId);
    if (existing !== undefined) return Promise.resolve(existing);
    const payment: GatewayPayment = {
      paymentIntentId: `pi_fake_${generateUuidV4().slice(0, ID_SUFFIX_LENGTH)}`,
      status: 'pending',
      amountCents: input.amountCents,
      refundedCents: 0,
      clientSecret: `pi_secret_${generateUuidV4().slice(0, ID_SUFFIX_LENGTH)}`,
      metadata: input.metadata,
    };
    this.payments.set(payment.paymentIntentId, payment);
    this.paymentsByKey.set(input.idempotencyKey, payment.paymentIntentId);
    return Promise.resolve(payment);
  }

  readPayment(input: { paymentIntentId: string }): Promise<GatewayPayment> {
    const payment = this.payments.get(input.paymentIntentId);
    if (payment === undefined) return Promise.reject(new Error('Unknown fake payment'));
    return Promise.resolve(payment);
  }

  /** Un aviso de prueba válido si el cuerpo es `{ "type": ..., "paymentIntentId": ... }`. */
  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
  }): GatewayWebhookEvent | null {
    if (input.signatureHeader !== 'fake-signature') return null;
    const body = JSON.parse(input.rawBody.toString('utf8')) as {
      type?: string;
      paymentIntentId?: string;
      accountId?: string;
    };
    return {
      type: body.type ?? '',
      paymentIntentId: body.paymentIntentId ?? null,
      accountId: body.accountId ?? null,
    };
  }

  completeOnboarding(accountId: string): void {
    this.chargeableAccounts.add(accountId);
  }

  /** Lo que haría el centro al devolver dinero desde su panel de Stripe. */
  refund(input: { paymentIntentId: string; refundedCents: number }): void {
    const payment = this.payments.get(input.paymentIntentId);
    if (payment !== undefined) {
      this.payments.set(input.paymentIntentId, { ...payment, refundedCents: input.refundedCents });
    }
  }

  succeed(paymentIntentId: string): void {
    const payment = this.payments.get(paymentIntentId);
    if (payment !== undefined) {
      this.payments.set(paymentIntentId, { ...payment, status: 'succeeded' });
    }
  }
}
