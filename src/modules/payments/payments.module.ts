import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../shared/config/environment.schema';
import {
  ConfirmPaymentUseCase,
  GetPaymentsStatusUseCase,
  HandleStripeWebhookUseCase,
  ListPaymentsUseCase,
  PayTargetUseCase,
  PaymentsStatusReader,
  SettlePaymentService,
  StartPaymentsOnboardingUseCase,
} from './application/payment.use-cases';
import { PAYMENT_GATEWAY, type PaymentGateway } from './application/ports/payment-gateway';
import { PAYMENT_REPOSITORY } from './application/ports/payment.repository';
import { PaymentsController, PaymentWebhooksController } from './http/payments.controller';
import { FakePaymentGateway } from './infrastructure/fake-payment-gateway';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository';
import { StripePaymentGateway } from './infrastructure/stripe-payment-gateway';

function createPaymentGateway(configService: ConfigService<Environment, true>): PaymentGateway {
  if (configService.get('PAYMENT_PROVIDER', { infer: true }) !== 'stripe') {
    return new FakePaymentGateway();
  }
  // El esquema de entorno ya exige estas dos claves con PAYMENT_PROVIDER=stripe.
  const read = (name: 'STRIPE_SECRET_KEY' | 'STRIPE_PUBLISHABLE_KEY'): string =>
    configService.get(name, { infer: true });
  return new StripePaymentGateway({
    secretKey: read('STRIPE_SECRET_KEY'),
    webhookSecret: configService.get('STRIPE_WEBHOOK_SECRET', { infer: true }) ?? null,
    publishableKey: read('STRIPE_PUBLISHABLE_KEY'),
    returnUrl: configService.get('STRIPE_CONNECT_RETURN_URL', { infer: true }),
    refreshUrl: configService.get('STRIPE_CONNECT_REFRESH_URL', { infer: true }),
  });
}

@Module({
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [
    { provide: PAYMENT_GATEWAY, inject: [ConfigService], useFactory: createPaymentGateway },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    PaymentsStatusReader,
    SettlePaymentService,
    GetPaymentsStatusUseCase,
    ListPaymentsUseCase,
    StartPaymentsOnboardingUseCase,
    PayTargetUseCase,
    ConfirmPaymentUseCase,
    HandleStripeWebhookUseCase,
  ],
})
export class PaymentsModule {}
