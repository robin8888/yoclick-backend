import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../shared/config/environment.schema';
import {
  CreateCheckoutSessionUseCase,
  CreatePortalSessionUseCase,
  HandleBillingWebhookUseCase,
  ListPlanOffersUseCase,
  SweepSubscriptionsUseCase,
  SyncStripePlansUseCase,
} from './application/billing.use-cases';
import { BILLING_GATEWAY, type BillingGateway } from './application/ports/billing-gateway';
import { BILLING_REPOSITORY } from './application/ports/billing.repository';
import { CloseCenterUseCase } from './application/close-center.use-case';
import { PlanPaymentEmailScheduler } from './application/plan-payment-email-scheduler';
import { PlanPaymentLinkService } from './application/plan-payment-link.service';
import {
  OpenPlanPaymentLinkUseCase,
  SendPlanPaymentEmailsUseCase,
} from './application/plan-payment.use-cases';
import { SubscriptionSweeper } from './application/subscription-sweeper';
import { BillingController } from './http/billing.controller';
import { PlanPaymentLinkController } from './http/plan-payment-link.controller';
import { FakeBillingGateway } from './infrastructure/fake-billing-gateway';
import { PrismaBillingRepository } from './infrastructure/prisma-billing.repository';
import { StripeBillingGateway } from './infrastructure/stripe-billing-gateway';

function createBillingGateway(configService: ConfigService<Environment, true>): BillingGateway {
  if (configService.get('PAYMENT_PROVIDER', { infer: true }) !== 'stripe') {
    return new FakeBillingGateway();
  }
  return new StripeBillingGateway({
    // El esquema de entorno ya exige la clave con PAYMENT_PROVIDER=stripe.
    secretKey: configService.get('STRIPE_SECRET_KEY', { infer: true }),
    webhookSecrets: [
      configService.get('STRIPE_WEBHOOK_SECRET', { infer: true }),
      configService.get('STRIPE_CONNECT_WEBHOOK_SECRET', { infer: true }),
    ].filter((secret): secret is string => secret !== undefined),
    successUrl: configService.get('BILLING_SUCCESS_URL', { infer: true }),
    cancelUrl: configService.get('BILLING_CANCEL_URL', { infer: true }),
    portalReturnUrl: configService.get('BILLING_PORTAL_RETURN_URL', { infer: true }),
  });
}

/** El cobro de los planes a los centros con Stripe Billing (docs/spec/17, fase P5). */
@Module({
  controllers: [BillingController, PlanPaymentLinkController],
  providers: [
    { provide: BILLING_GATEWAY, inject: [ConfigService], useFactory: createBillingGateway },
    { provide: BILLING_REPOSITORY, useClass: PrismaBillingRepository },
    ListPlanOffersUseCase,
    CreateCheckoutSessionUseCase,
    CreatePortalSessionUseCase,
    HandleBillingWebhookUseCase,
    SweepSubscriptionsUseCase,
    SyncStripePlansUseCase,
    PlanPaymentLinkService,
    OpenPlanPaymentLinkUseCase,
    SendPlanPaymentEmailsUseCase,
    PlanPaymentEmailScheduler,
    SubscriptionSweeper,
    CloseCenterUseCase,
  ],
  exports: [
    HandleBillingWebhookUseCase,
    SweepSubscriptionsUseCase,
    BILLING_GATEWAY,
    BILLING_REPOSITORY,
    CloseCenterUseCase,
  ],
})
export class BillingModule {}
