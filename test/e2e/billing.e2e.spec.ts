import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  SweepSubscriptionsUseCase,
  SyncStripePlansUseCase,
} from '../../src/modules/billing/application/billing.use-cases';
import { PlanPaymentLinkService } from '../../src/modules/billing/application/plan-payment-link.service';
import { SendPlanPaymentEmailsUseCase } from '../../src/modules/billing/application/plan-payment.use-cases';
import { EMAIL_SENDER, type EmailSender } from '../../src/shared/email/email-sender';
import { BILLING_GATEWAY } from '../../src/modules/billing/application/ports/billing-gateway';
import { FakeBillingGateway } from '../../src/modules/billing/infrastructure/fake-billing-gateway';
import { BookingWorld } from '../support/booking-world';
import {
  grantPlatformRoleAsOwner,
  resetTestDatabase,
  runStatementAsOwnerForUser,
  setPlanClientLimitAsPlatform,
} from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface Subscription {
  status: string;
  trialEndsAt: string | null;
  maxClients: number | null;
  planId: string;
  billingPeriod: string | null;
  graceEndsAt: string | null;
  hasSubscription: boolean;
  isPlanRequired: boolean;
  features: string[];
}

interface PlanOffers {
  plans: {
    id: string;
    monthlyPriceCents: number;
    annualMonthlyPriceCents: number;
    setupFeeCents: number;
    maxClients: number | null;
    videoStorageLimitBytes: number | null;
    isAvailable: boolean;
  }[];
}

interface ChargePage {
  data: {
    centerId: string;
    source: string;
    status: string;
    baseCents: number;
    vatCents: number;
    vatBasisPoints: number;
    totalCents: number;
    stripeId: string | null;
  }[];
}

const FAKE_SIGNATURE = 'fake-signature';
const MILLISECONDS_PER_DAY = 86_400_000;

describe('plan billing with Stripe', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let gateway: FakeBillingGateway;
  let ownerUserId: string;
  let adminUserId: string;
  let centerId: string;
  let customerId: string;
  let eventCounter = 0;

  const asOwner = (method: 'GET' | 'POST', url: string, body?: object) =>
    world.call(method, url, ownerUserId, { centerId, ...(body === undefined ? {} : { body }) });

  const readSubscription = async (): Promise<Subscription> =>
    (await asOwner('GET', `/v1/centers/${centerId}/subscription`)).json<Subscription>();

  const sendBillingEvent = async (billingEvent: object) => {
    eventCounter += 1;
    return world.call('POST', '/v1/webhooks/stripe', undefined, {
      headers: { 'stripe-signature': FAKE_SIGNATURE },
      body: { billingEvent: { eventId: `evt_${String(eventCounter)}`, ...billingEvent } },
    });
  };

  const sendInvoicePaid = (overrides: object = {}) =>
    sendBillingEvent({
      type: 'invoice_paid',
      customerId,
      invoiceId: 'in_1',
      invoiceNumber: null,
      baseCents: 7900,
      vatCents: 1659,
      totalCents: 9559,
      paidAt: new Date().toISOString(),
      description: 'Plan Pro',
      ...overrides,
    });

  const listChargesAsAdmin = async (): Promise<ChargePage['data']> => {
    const response = await world.call('GET', '/v1/platform/charges', adminUserId);
    return response.json<ChargePage>().data;
  };

  const setCenterColumns = (assignments: string) =>
    runStatementAsOwnerForUser(
      ownerUserId,
      `update "centers" set ${assignments} where "id" = '${centerId}'`,
      centerId,
    );

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
    gateway = application.get<FakeBillingGateway>(BILLING_GATEWAY);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    gateway.checkoutRequests.length = 0;
    ownerUserId = await world.fixtures.createUser('owner');
    adminUserId = await world.fixtures.createUser('platform-admin');
    await grantPlatformRoleAsOwner(adminUserId, 'admin');
    centerId = (await world.createCenter(ownerUserId, 'Studio Norte')).centerId;
    customerId = `cus_fake_${centerId}`;
    await setCenterColumns(`"stripe_customer_id" = '${customerId}'`);
  });

  afterAll(async () => {
    await application.close();
  });

  describe('POST /centers/:centerId/subscription/checkout', () => {
    it('refuses while the plans have no prices in Stripe yet', async () => {
      const response = await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
        planId: 'pro',
        period: 'monthly',
      });

      expect(response.statusCode).toBe(409);
    });

    it('gives the payment page and delays the first charge until the trial ends', async () => {
      await application.get(SyncStripePlansUseCase).execute();

      const response = await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
        planId: 'pro',
        period: 'monthly',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ url: string }>().url).toContain('checkout');
      const request = gateway.checkoutRequests[0];
      expect(request).toMatchObject({
        planId: 'pro',
        priceId: 'price_fake_pro_monthly',
        setupFeePriceId: null,
        customerId,
      });
      const { trialEndsAt } = await readSubscription();
      expect(request?.firstChargeAt?.toISOString()).toBe(trialEndsAt);
    });

    it('uses the annual price, and adds the set-up fee of Premium', async () => {
      await application.get(SyncStripePlansUseCase).execute();

      await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
        planId: 'premium',
        period: 'annual',
      });

      expect(gateway.checkoutRequests[0]).toMatchObject({
        priceId: 'price_fake_premium_annual',
        setupFeePriceId: 'price_fake_premium_setup',
      });
    });

    it('charges at once when the trial is over', async () => {
      await application.get(SyncStripePlansUseCase).execute();
      await setCenterColumns(`"trial_ends_at" = now() - interval '1 day'`);

      await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
        planId: 'basic',
        period: 'monthly',
      });

      expect(gateway.checkoutRequests[0]?.firstChargeAt).toBeNull();
    });

    it('creates the Stripe customer once and then reuses it', async () => {
      await application.get(SyncStripePlansUseCase).execute();
      await setCenterColumns(`"stripe_customer_id" = null`);

      await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
        planId: 'pro',
        period: 'monthly',
      });
      await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
        planId: 'pro',
        period: 'annual',
      });

      expect(gateway.checkoutRequests.map((request) => request.customerId)).toEqual([
        customerId,
        customerId,
      ]);
    });

    it('refuses a center that already pays a plan', async () => {
      await application.get(SyncStripePlansUseCase).execute();
      await setCenterColumns(`"status" = 'active', "stripe_subscription_id" = 'sub_1'`);

      const response = await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
        planId: 'pro',
        period: 'monthly',
      });

      expect(response.statusCode).toBe(409);
    });

    it('is only for the owner', async () => {
      await application.get(SyncStripePlansUseCase).execute();
      const staff = await world.addMember(centerId, 'staff', 'staff');

      const response = await world.call(
        'POST',
        `/v1/centers/${centerId}/subscription/checkout`,
        staff.userId,
        { centerId, body: { planId: 'pro', period: 'monthly' } },
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /centers/:centerId/subscription/plans', () => {
    it('lists the three plans with their monthly and annual prices, but not yet available', async () => {
      const response = await asOwner('GET', `/v1/centers/${centerId}/subscription/plans`);

      expect(response.statusCode).toBe(200);
      const { plans } = response.json<PlanOffers>();
      expect(plans.map((plan) => plan.id)).toEqual(['basic', 'pro', 'premium']);
      expect(plans[1]).toMatchObject({
        monthlyPriceCents: 7900,
        annualMonthlyPriceCents: 6500,
        maxClients: 500,
        isAvailable: false,
      });
      expect(plans[2]).toMatchObject({ setupFeeCents: 29000, maxClients: null });
    });

    it('marks the plans as available once their prices exist in Stripe', async () => {
      await application.get(SyncStripePlansUseCase).execute();

      const response = await asOwner('GET', `/v1/centers/${centerId}/subscription/plans`);

      expect(response.json<PlanOffers>().plans.every((plan) => plan.isAvailable)).toBe(true);
    });

    it('is only for the owner', async () => {
      const staff = await world.addMember(centerId, 'staff', 'staff');

      const response = await world.call(
        'GET',
        `/v1/centers/${centerId}/subscription/plans`,
        staff.userId,
        { centerId },
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /centers/:centerId/subscription/portal', () => {
    it('gives the Stripe portal to a center that has already contracted a plan', async () => {
      const response = await asOwner('POST', `/v1/centers/${centerId}/subscription/portal`);

      expect(response.statusCode).toBe(200);
      expect(response.json<{ url: string }>().url).toContain('portal');
      expect(gateway.portalCustomerIds).toEqual([customerId]);
    });

    it('refuses a center that has never paid, which has nothing to manage', async () => {
      await setCenterColumns(`"stripe_customer_id" = null`);

      const response = await asOwner('POST', `/v1/centers/${centerId}/subscription/portal`);

      expect(response.statusCode).toBe(409);
    });

    it('is only for the owner', async () => {
      const staff = await world.addMember(centerId, 'staff', 'staff');

      const response = await world.call(
        'POST',
        `/v1/centers/${centerId}/subscription/portal`,
        staff.userId,
        { centerId },
      );

      expect(response.statusCode).toBe(403);
    });

    it('sets the portal up when the plans are synced', async () => {
      const before = gateway.portalConfigurations;

      await application.get(SyncStripePlansUseCase).execute();

      expect(gateway.portalConfigurations).toBe(before + 1);
    });
  });

  describe('plan changes made in the portal', () => {
    const changePlan = (planId: string | null, period: string | null) =>
      sendBillingEvent({
        type: 'subscription_changed',
        customerId,
        subscriptionId: 'sub_1',
        status: 'active',
        planId,
        period,
      });

    it('moves the center to the new plan with its limits and keeps it active', async () => {
      await sendInvoicePaid();

      await changePlan('basic', 'monthly');

      expect(await readSubscription()).toMatchObject({
        status: 'active',
        planId: 'basic',
        billingPeriod: 'monthly',
        maxClients: 150,
      });
    });

    it('records the new period when only the period changes', async () => {
      await sendInvoicePaid();

      await changePlan('pro', 'annual');

      expect(await readSubscription()).toMatchObject({ planId: 'pro', billingPeriod: 'annual' });
    });

    it('leaves the plan alone when the notice does not say which one it is', async () => {
      await sendInvoicePaid();

      await changePlan(null, null);

      expect(await readSubscription()).toMatchObject({ status: 'active', planId: 'pro' });
    });
  });

  describe('notices to the owner about the plan', () => {
    interface OwnerNotice {
      kind: string;
      data: { planId: string };
    }

    const listOwnerNotices = async (): Promise<OwnerNotice[]> => {
      const response = await asOwner('GET', `/v1/centers/${centerId}/notifications`);
      return response.json<{ notifications: OwnerNotice[] }>().notifications;
    };

    const completeCheckout = (planId: string) =>
      sendBillingEvent({
        type: 'checkout_completed',
        centerId,
        planId,
        period: 'monthly',
        customerId,
        subscriptionId: 'sub_1',
      });

    const changePlanInPortal = (planId: string) =>
      sendBillingEvent({
        type: 'subscription_changed',
        customerId,
        subscriptionId: 'sub_1',
        status: 'active',
        planId,
        period: 'monthly',
      });

    it('tells the owner when the center contracts a plan', async () => {
      await completeCheckout('premium');

      expect(await listOwnerNotices()).toEqual([
        expect.objectContaining({ kind: 'plan_subscribed', data: { planId: 'premium' } }),
      ]);
    });

    it('tells the owner when the plan is changed afterwards, and only once', async () => {
      await completeCheckout('pro');
      await changePlanInPortal('basic');
      await changePlanInPortal('basic');

      const kinds = (await listOwnerNotices()).map(({ kind }) => kind);

      expect(kinds).toHaveLength(2);
      expect(kinds).toEqual(expect.arrayContaining(['plan_changed', 'plan_subscribed']));
    });

    describe('when the new plan admits fewer clients than the center has', () => {
      const setBasicClientLimit = (limit: number) => setPlanClientLimitAsPlatform('basic', limit);

      beforeEach(async () => {
        await world.addMember(centerId, 'first-client', 'client');
        await world.addMember(centerId, 'second-client', 'client');
      });

      it('warns the owner once, with the numbers, and does not touch any client', async () => {
        await setBasicClientLimit(1);
        await completeCheckout('pro');
        await changePlanInPortal('basic');
        await changePlanInPortal('basic');

        const overLimitNotices = (await listOwnerNotices()).filter(
          ({ kind }) => kind === 'plan_over_limit',
        );

        expect(overLimitNotices).toEqual([
          expect.objectContaining({
            data: { planId: 'basic', activeClientCount: '2', maxClients: '1' },
          }),
        ]);
        expect(await readSubscription()).toMatchObject({ planId: 'basic', activeClientCount: 2 });
      });

      it('also warns when the first plan bought already admits fewer clients', async () => {
        await setBasicClientLimit(1);
        await completeCheckout('basic');

        const kinds = (await listOwnerNotices()).map(({ kind }) => kind);

        expect(kinds).toEqual(expect.arrayContaining(['plan_subscribed', 'plan_over_limit']));
      });

      it('says nothing when the clients still fit in the new plan', async () => {
        await completeCheckout('pro');
        await changePlanInPortal('basic');

        const kinds = (await listOwnerNotices()).map(({ kind }) => kind);

        expect(kinds).not.toContain('plan_over_limit');
      });
    });

    it('does not tell twice about the first plan when the portal notice arrives before the checkout', async () => {
      await changePlanInPortal('premium');
      await completeCheckout('premium');

      expect((await listOwnerNotices()).map(({ kind }) => kind)).toEqual(['plan_subscribed']);
    });
  });

  describe('what the plan allows', () => {
    const createGroup = () =>
      asOwner('POST', `/v1/centers/${centerId}/groups`, { name: 'Mañanas' });

    it('lets a center in its trial work and does not ask for a plan yet', async () => {
      expect((await createGroup()).statusCode).toBe(201);
      expect(await readSubscription()).toMatchObject({ isPlanRequired: false });
    });

    it('stops the owner from changing anything once the trial ended without a plan', async () => {
      await setCenterColumns(`"trial_ends_at" = now() - interval '1 hour'`);

      const response = await createGroup();

      expect(response.statusCode).toBe(402);
      expect(response.json<{ code: string }>().code).toBe('PLAN_REQUIRED');
      expect(await readSubscription()).toMatchObject({ isPlanRequired: true });
    });

    it('still lets that owner read, see the plans and start the payment', async () => {
      await setCenterColumns(`"trial_ends_at" = now() - interval '1 hour'`);
      await application.get(SyncStripePlansUseCase).execute();

      expect((await asOwner('GET', `/v1/centers/${centerId}/groups`)).statusCode).toBe(200);
      expect((await asOwner('GET', `/v1/centers/${centerId}/subscription/plans`)).statusCode).toBe(
        200,
      );
      expect(
        (
          await asOwner('POST', `/v1/centers/${centerId}/subscription/checkout`, {
            planId: 'pro',
            period: 'monthly',
          })
        ).statusCode,
      ).toBe(200);
    });

    it('works again as soon as the plan is paid', async () => {
      await setCenterColumns(`"trial_ends_at" = now() - interval '1 hour'`);
      await sendBillingEvent({
        type: 'checkout_completed',
        centerId,
        planId: 'pro',
        period: 'monthly',
        customerId,
        subscriptionId: 'sub_1',
      });

      expect((await createGroup()).statusCode).toBe(201);
    });

    it('refuses what the Basic plan does not include and shows what each plan gives', async () => {
      await setCenterColumns(`"plan_id" = 'basic'`);

      const response = await asOwner('GET', `/v1/centers/${centerId}/reports`);

      expect(response.statusCode).toBe(402);
      expect(response.json<{ code: string }>().code).toBe('PLAN_FEATURE_NOT_INCLUDED');
      expect((await readSubscription()).features).toEqual([]);
    });

    it('gives the Pro features to the Pro plan', async () => {
      expect((await readSubscription()).features).toEqual(expect.arrayContaining(['reports']));
    });
  });

  describe('GET /centers/:centerId/subscription', () => {
    it('says the center is on the Pro trial with nothing contracted yet', async () => {
      expect(await readSubscription()).toMatchObject({
        planId: 'pro',
        billingPeriod: null,
        graceEndsAt: null,
        hasSubscription: false,
      });
    });

    it('shows the contracted plan and period after the checkout', async () => {
      await sendBillingEvent({
        type: 'checkout_completed',
        centerId,
        planId: 'basic',
        period: 'annual',
        customerId,
        subscriptionId: 'sub_1',
      });

      expect(await readSubscription()).toMatchObject({
        planId: 'basic',
        billingPeriod: 'annual',
        hasSubscription: true,
      });
    });

    it('shows when the grace ends after a failed payment', async () => {
      await sendBillingEvent({ type: 'payment_failed', customerId });

      const { status, graceEndsAt } = await readSubscription();

      expect(status).toBe('past_due');
      expect(graceEndsAt).not.toBeNull();
    });
  });

  describe('Stripe notices', () => {
    it('activates the center and records the charge when an invoice is paid', async () => {
      const response = await sendInvoicePaid();

      expect(response.statusCode).toBe(204);
      expect((await readSubscription()).status).toBe('active');
      expect(await listChargesAsAdmin()).toEqual([
        expect.objectContaining({
          centerId,
          source: 'stripe',
          status: 'paid',
          baseCents: 7900,
          vatCents: 1659,
          vatBasisPoints: 2100,
          totalCents: 9559,
          stripeId: 'in_1',
        }),
      ]);
    });

    it('does not process the same notice twice', async () => {
      await sendInvoicePaid({ eventId: 'evt_same' });
      await sendInvoicePaid({ eventId: 'evt_same', invoiceId: 'in_2', totalCents: 121 });

      expect(await listChargesAsAdmin()).toHaveLength(1);
    });

    it('does not record the same invoice twice even in two different notices', async () => {
      await sendInvoicePaid();
      await sendInvoicePaid();

      expect(await listChargesAsAdmin()).toHaveLength(1);
    });

    it('ignores a 0 € invoice, such as the start of a trial', async () => {
      await sendInvoicePaid({ baseCents: 0, vatCents: 0, totalCents: 0 });

      expect((await readSubscription()).status).toBe('trial');
      expect(await listChargesAsAdmin()).toEqual([]);
    });

    it('puts the center in grace for seven days when a payment fails, and pays it back to active', async () => {
      await sendBillingEvent({ type: 'payment_failed', customerId });

      expect((await readSubscription()).status).toBe('past_due');
      const graceEndsAt = await readGraceEndsAt();
      const days = (new Date(graceEndsAt ?? 0).getTime() - Date.now()) / MILLISECONDS_PER_DAY;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);

      await sendInvoicePaid();

      expect((await readSubscription()).status).toBe('active');
      expect(await readGraceEndsAt()).toBeNull();
    });

    it('suspends the center when Stripe cancels the subscription', async () => {
      await sendInvoicePaid();

      await sendBillingEvent({
        type: 'subscription_changed',
        customerId,
        subscriptionId: 'sub_1',
        status: 'canceled',
        planId: null,
        period: null,
      });

      expect((await readSubscription()).status).toBe('suspended');
    });

    it('moves the center to the plan it paid for, with the limits of that plan', async () => {
      await sendBillingEvent({
        type: 'checkout_completed',
        centerId,
        planId: 'basic',
        period: 'annual',
        customerId,
        subscriptionId: 'sub_1',
      });

      expect((await readSubscription()).maxClients).toBe(150);
    });

    it('ignores a notice for a customer that is not a center of ours', async () => {
      const response = await sendInvoicePaid({ customerId: 'cus_unknown' });

      expect(response.statusCode).toBe(204);
      expect(await listChargesAsAdmin()).toEqual([]);
    });

    it('rejects a notice with a forged signature', async () => {
      const response = await world.call('POST', '/v1/webhooks/stripe', undefined, {
        headers: { 'stripe-signature': 'forged' },
        body: { billingEvent: { type: 'payment_failed', eventId: 'evt_x', customerId } },
      });

      expect(response.statusCode).toBe(400);
      expect((await readSubscription()).status).toBe('trial');
    });
  });

  describe('the daily sweep', () => {
    const sweep = () => application.get(SweepSubscriptionsUseCase).execute(new Date());

    it('opens the grace of a trial that ended without a plan, then suspends when it runs out', async () => {
      await setCenterColumns(`"trial_ends_at" = now() - interval '1 hour'`);

      expect(await sweep()).toEqual({ gracesOpened: 1, centersSuspended: 0 });
      expect((await readSubscription()).status).toBe('past_due');

      await setCenterColumns(`"grace_ends_at" = now() - interval '1 hour'`);

      expect(await sweep()).toEqual({ gracesOpened: 0, centersSuspended: 1 });
      expect((await readSubscription()).status).toBe('suspended');
    });

    it('leaves alone a trial that is still running', async () => {
      expect(await sweep()).toEqual({ gracesOpened: 0, centersSuspended: 0 });
      expect((await readSubscription()).status).toBe('trial');
    });

    it('leaves alone a trial that ended but already has a subscription', async () => {
      await setCenterColumns(
        `"trial_ends_at" = now() - interval '1 day', "stripe_subscription_id" = 'sub_1'`,
      );

      expect(await sweep()).toEqual({ gracesOpened: 0, centersSuspended: 0 });
    });

    it('leaves a paying center alone', async () => {
      await sendInvoicePaid();

      expect(await sweep()).toEqual({ gracesOpened: 0, centersSuspended: 0 });
      expect((await readSubscription()).status).toBe('active');
    });
  });

  describe('payment links in emails', () => {
    const openLink = (url: string) => {
      const { pathname, search } = new URL(url, 'https://api.yoclick.app');
      return application.inject({ method: 'GET', url: `${pathname}${search}` });
    };

    const sendEmails = () => application.get(SendPlanPaymentEmailsUseCase).execute(new Date());

    it('redirects an owner who opens the signed link to a fresh Stripe checkout, without a session', async () => {
      await application.get(SyncStripePlansUseCase).execute();
      const url = await application
        .get(PlanPaymentLinkService)
        .buildUrl({ centerId, planId: 'pro', period: 'annual' });

      const response = await openLink(url);

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('checkout');
      expect(gateway.checkoutRequests[0]).toMatchObject({
        centerId,
        planId: 'pro',
        priceId: 'price_fake_pro_annual',
        customerId,
      });
    });

    it('refuses a link that was not signed by the API', async () => {
      const response = await openLink('/v1/billing/pay?token=not-a-token');

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('PAYMENT_LINK_INVALID');
      expect(gateway.checkoutRequests).toHaveLength(0);
    });

    it('emails the owner once per reminder when the trial is about to end, and never twice', async () => {
      await application.get(SyncStripePlansUseCase).execute();
      await setCenterColumns(`"trial_ends_at" = now() + interval '2 days'`);
      const send = jest.spyOn(application.get<EmailSender>(EMAIL_SENDER), 'send');

      const firstRun = await sendEmails();
      const secondRun = await sendEmails();

      expect(firstRun).toEqual({ emailsSent: 1, centersFailed: 0 });
      expect(secondRun).toEqual({ emailsSent: 0, centersFailed: 0 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0].subject).toBe('Tu prueba de Yoclick acaba en 3 días');
      send.mockRestore();
    });

    it('writes again when the trial has ended, but not to a center that already pays', async () => {
      await application.get(SyncStripePlansUseCase).execute();
      await setCenterColumns(`"trial_ends_at" = now() + interval '2 days'`);
      await sendEmails();
      await setCenterColumns(`"trial_ends_at" = now() - interval '1 hour'`);
      const send = jest.spyOn(application.get<EmailSender>(EMAIL_SENDER), 'send');

      await sendEmails();
      await setCenterColumns(
        `"trial_ends_at" = now() - interval '2 hours', "stripe_subscription_id" = 'sub_1'`,
      );
      await sendEmails();

      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0].subject).toBe('Tu prueba de Yoclick ha terminado');
      send.mockRestore();
    });
  });

  async function readGraceEndsAt(): Promise<string | null> {
    const detail = await world.call('GET', `/v1/platform/centers/${centerId}`, adminUserId);
    return detail.json<{ graceEndsAt: string | null }>().graceEndsAt;
  }
});
