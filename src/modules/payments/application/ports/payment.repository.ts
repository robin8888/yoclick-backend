import { type ActorContext } from '../../../../shared/tenancy/actor-context';

/** Lo que se sabe del centro para decidir si puede cobrar online. */
export interface CenterPaymentsInfo {
  readonly name: string;
  readonly contactEmail: string | null;
  /** El plan Premium es el único sin tope de clientes. */
  readonly isPremium: boolean;
  readonly stripeAccountId: string | null;
  readonly stripeChargesEnabled: boolean;
}

export interface PaymentTarget {
  readonly kind: 'pass';
  readonly id: string;
}

/** Lo que una persona puede pagar: el bono que pidió (un alquiler de sala es una clase y se paga con bono). */
export interface PayableTarget {
  readonly target: PaymentTarget;
  readonly amountCents: number;
  readonly description: string;
  readonly clientMembershipId: string;
}

export interface PaymentRecord {
  readonly id: string;
  readonly centerId: string;
  readonly clientMembershipId: string;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly amountCents: number;
  readonly stripePaymentIntentId: string;
}

export interface NewPaymentRecord {
  readonly id: string;
  readonly target: PaymentTarget;
  readonly clientMembershipId: string;
  readonly amountCents: number;
  readonly stripePaymentIntentId: string;
}

export type PaymentSettlementOutcome =
  | { readonly kind: 'settled'; readonly payment: PaymentRecord }
  | { readonly kind: 'already_settled'; readonly payment: PaymentRecord }
  | { readonly kind: 'not_found' }
  /** El importe cobrado no es el que se debía: no se activa nada. */
  | { readonly kind: 'amount_mismatch' };

/** Un cobro tal y como lo ve la administración. */
export interface PaymentListItem {
  readonly id: string;
  readonly kind: 'pass';
  /** El bono que se pagó. */
  readonly label: string;
  readonly clientName: string;
  readonly amountCents: number;
  readonly refundedCents: number;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly createdAt: Date;
  readonly paidAt: Date | null;
}

export interface PaymentRepository {
  /** Los últimos cobros del centro, de más reciente a más antiguo. */
  listPayments(actor: ActorContext, query: { limit: number }): Promise<PaymentListItem[]>;
  getCenterPaymentsInfo(actor: ActorContext): Promise<CenterPaymentsInfo | null>;
  /** Guarda la cuenta solo si el centro aún no tenía una; devuelve la que queda vigente. */
  saveStripeAccount(actor: ActorContext, accountId: string): Promise<string>;
  saveChargesEnabled(actor: ActorContext, canCharge: boolean): Promise<void>;
  /** El bono pendiente o el alquiler sin pagar de la persona que pregunta; `null` si no es suyo o no se debe. */
  findPayableTarget(actor: ActorContext, target: PaymentTarget): Promise<PayableTarget | null>;
  /** El cobro abierto de ese destino, para no crear uno nuevo en cada intento. */
  findPendingPayment(actor: ActorContext, target: PaymentTarget): Promise<PaymentRecord | null>;
  createPayment(actor: ActorContext, payment: NewPaymentRecord): Promise<PaymentRecord>;
  findPaymentOfActor(actor: ActorContext, paymentId: string): Promise<PaymentRecord | null>;
  /**
   * Da el cobro por pagado y activa lo comprado. Idempotente: un cobro ya liquidado no cambia nada.
   * Lo llaman la confirmación de la app y el aviso de Stripe, que pueden llegar en cualquier orden.
   */
  /**
   * Anota lo devuelto desde el panel de Stripe. Nunca baja la cifra (los avisos pueden llegar
   * desordenados) y, si la devolución es total, anula el bono que se pagó. Idempotente.
   */
  recordRefund(command: {
    centerId: string;
    stripePaymentIntentId: string;
    refundedCents: number;
    now: Date;
  }): Promise<void>;
  settlePayment(command: {
    centerId: string;
    stripePaymentIntentId: string;
    paidAmountCents: number;
    now: Date;
  }): Promise<PaymentSettlementOutcome>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
