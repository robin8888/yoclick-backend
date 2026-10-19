import { splitVatIncluded, VAT_RATE_PERCENT } from '../domain/receipt-rules';
import { type PaymentListItem, type ReceiptView } from '../application/ports/payment.repository';

export function serializePaymentItem(payment: PaymentListItem): Record<string, unknown> {
  return {
    ...payment,
    createdAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
  };
}

export function serializeReceipt(receipt: ReceiptView): Record<string, unknown> {
  const { baseCents, vatCents } = splitVatIncluded(receipt.totalCents);
  return {
    receiptNumber: receipt.receiptNumber,
    issuedAt: receipt.issuedAt.toISOString(),
    seller: receipt.seller,
    buyerName: receipt.buyerName,
    concept: receipt.concept,
    baseCents,
    vatRatePercent: VAT_RATE_PERCENT,
    vatCents,
    totalCents: receipt.totalCents,
    refundedCents: receipt.refundedCents,
  };
}
