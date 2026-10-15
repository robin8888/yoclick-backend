/** Lo que Stripe dice de la cuenta de cobros de un centro. */
export interface ConnectedAccountState {
  /** Ya puede cobrar: Stripe verificó su identidad y su cuenta bancaria. */
  readonly canCharge: boolean;
  /** Terminó de rellenar el formulario de alta (puede faltar la verificación de Stripe). */
  readonly hasSubmittedDetails: boolean;
}

export type GatewayPaymentStatus = 'succeeded' | 'pending' | 'failed';

/** Un cobro tal y como lo conoce la pasarela. */
export interface GatewayPayment {
  readonly paymentIntentId: string;
  readonly status: GatewayPaymentStatus;
  readonly amountCents: number;
  /** Secreto con el que la app confirma el pago; solo se entrega a quien paga. */
  readonly clientSecret: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface NewGatewayPayment {
  /** Cuenta del centro (acct_...): el cobro se crea en ella y el dinero no pasa por Yoclick. */
  readonly accountId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** Reintentar con la misma clave devuelve el mismo cobro, nunca uno nuevo. */
  readonly idempotencyKey: string;
}

/** Un aviso de la pasarela ya verificado; solo nos interesan los cobros. */
export interface GatewayWebhookEvent {
  readonly type: string;
  readonly paymentIntentId: string | null;
  /** Cuenta del centro en la que ocurrió el aviso (eventos Connect); `null` si es de la plataforma. */
  readonly accountId: string | null;
}

/**
 * La pasarela de cobros (Stripe Connect). Cobros directos: el PaymentIntent vive en la cuenta del
 * centro, que es el comerciante y asume comisiones, devoluciones y disputas; Yoclick solo es el
 * software (docs/spec/01-arquitectura.md).
 */
export interface PaymentGateway {
  /** Clave pública que necesita la app para abrir la hoja de pago. */
  readonly publishableKey: string;
  createConnectedAccount(input: {
    centerId: string;
    businessName: string;
    contactEmail: string | null;
  }): Promise<{ accountId: string }>;
  /** Enlace de un solo uso al formulario de alta de Stripe. */
  createOnboardingLink(accountId: string): Promise<{ url: string }>;
  /** Enlace de un solo uso al panel Express del centro, donde hace reembolsos y ve disputas. */
  createDashboardLink(accountId: string): Promise<{ url: string }>;
  readConnectedAccount(accountId: string): Promise<ConnectedAccountState>;
  createPayment(input: NewGatewayPayment): Promise<GatewayPayment>;
  readPayment(input: { paymentIntentId: string; accountId: string }): Promise<GatewayPayment>;
  /** `null` si la firma no es válida o el aviso es antiguo (SEC-66). */
  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    now: Date;
  }): GatewayWebhookEvent | null;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
