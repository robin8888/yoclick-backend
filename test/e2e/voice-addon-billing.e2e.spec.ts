import { randomUUID } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SyncStripePlansUseCase } from '../../src/modules/billing/application/billing.use-cases';
import { PlanPaymentLinkService } from '../../src/modules/billing/application/plan-payment-link.service';
import { BILLING_GATEWAY } from '../../src/modules/billing/application/ports/billing-gateway';
import { FakeBillingGateway } from '../../src/modules/billing/infrastructure/fake-billing-gateway';
import { VoiceOverageReportSweeper } from '../../src/modules/voice-receptionist/application/voice-overage-report-sweeper';
import {
  FAKE_WEBHOOK_SECRET,
  FAKE_WEBHOOK_SECRET_HEADER,
} from '../../src/modules/voice-receptionist/infrastructure/fake-voice-agent-provider';
import { EMAIL_SENDER, type EmailMessage } from '../../src/shared/email/email-sender';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import {
  grantPlatformRoleAsOwner,
  resetTestDatabase,
  runStatementAsOwnerForUser,
} from '../support/test-database';
import { createTestApplication } from './create-test-application';

const DAY_MS = 86_400_000;
const FAKE_SIGNATURE = 'fake-signature';
const BRIDGE_NUMBER = '+34910000001';
const CALLER_NUMBER = '+34600111222';
const SUBSCRIPTION_ID = 'sub_1';
/** Pocos minutos incluidos para llegar al exceso con pocas llamadas. */
const INCLUDED_MINUTES = 10;
/** El tope de centro por defecto: se prueba con tantos números distintos como fallos admite. */
const CENTER_CODE_FAILURES_PER_HOUR = 20;

interface ToolBody {
  result: Record<string, unknown>;
}

interface Notice {
  kind: string;
  data: Record<string, string>;
}

const compareText = (first: string, second: string): number => first.localeCompare(second);

class RecordingEmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe('voice add-on billing and minute metering', () => {
  const emailSender = new RecordingEmailSender();
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let gateway: FakeBillingGateway;
  let sweeper: VoiceOverageReportSweeper;
  let adminUserId: string;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let customerId: string;
  let callCounter = 0;
  let eventCounter = 0;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;
  const platformUrl = (): string => `/v1/platform/centers/${centerId}/voice-receptionist`;
  const asOwner = (method: 'GET' | 'PUT' | 'POST', path: string, body?: object) =>
    world.call(method, url(path), ownerUserId, {
      centerId,
      ...(body === undefined ? {} : { body }),
    });
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;
  const newCallId = (): string => {
    callCounter += 1;
    return `call-${String(callCounter)}`;
  };

  const setCenterColumns = (assignments: string) =>
    runStatementAsOwnerForUser(
      ownerUserId,
      `update "centers" set ${assignments} where "id" = '${centerId}'`,
      centerId,
    );

  async function provision(body: object): Promise<number> {
    const response = await world.call('PUT', platformUrl(), adminUserId, { body });
    return response.statusCode;
  }

  /** Un centro con su suscripción de Stripe y el add-on añadido a ella, con pocos minutos incluidos. */
  async function provisionWithBilling(includedMinutes = INCLUDED_MINUTES): Promise<void> {
    expect(
      await provision({
        bridgeNumber: BRIDGE_NUMBER,
        provider: 'fake',
        includedMinutes,
        shouldBillWithStripe: true,
      }),
    ).toBe(204);
    expect((await asOwner('POST', '/voice-receptionist/enable')).statusCode).toBe(204);
  }

  const sendSubscriptionChanged = (overrides: object = {}) => {
    eventCounter += 1;
    return world.call('POST', '/v1/webhooks/stripe', undefined, {
      headers: { 'stripe-signature': FAKE_SIGNATURE },
      body: {
        billingEvent: {
          type: 'subscription_changed',
          eventId: `evt_${String(eventCounter)}`,
          customerId,
          subscriptionId: SUBSCRIPTION_ID,
          status: 'active',
          planId: 'pro',
          period: 'monthly',
          ...overrides,
        },
      },
    });
  };

  /** El periodo de cobro en el que ya está el add-on: un aviso de Stripe que lo repite no lo cambia. */
  const currentPeriod = (): [Date, Date] => {
    const period = gateway.voiceBillingPeriod;
    if (period === null) throw new Error('The fake gateway has no billing period');
    return [period.periodStart, period.periodEnd];
  };

  const voiceAddonPeriod = (periodStart: Date, periodEnd: Date) => ({
    isPresent: true,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });

  async function callTool(
    path: string,
    args: Record<string, unknown>,
    options: { callId?: string; caller?: string } = {},
  ): Promise<ToolBody> {
    const response = await world.call('POST', `/v1/webhooks/voice/${path}`, undefined, {
      headers: { [FAKE_WEBHOOK_SECRET_HEADER]: FAKE_WEBHOOK_SECRET },
      body: {
        providerCallId: options.callId ?? 'call-default',
        toolCallId: randomUUID(),
        calledNumber: BRIDGE_NUMBER,
        callerNumber: options.caller ?? CALLER_NUMBER,
        arguments: args,
      },
    });
    if (response.statusCode !== 200) throw new Error(`Tool ${path} failed: ${response.body}`);
    return response.json<ToolBody>();
  }

  const endOfCall = (callId: string, minutes: number) =>
    world.call('POST', '/v1/webhooks/voice/end-of-call', undefined, {
      headers: { [FAKE_WEBHOOK_SECRET_HEADER]: FAKE_WEBHOOK_SECRET },
      body: {
        providerCallId: callId,
        calledNumber: BRIDGE_NUMBER,
        callerNumber: CALLER_NUMBER,
        startedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
        endedAt: new Date().toISOString(),
        summary: 'Reserva de una clase',
        transcript: 'Hola',
      },
    });

  /** Una llamada de `minutes` minutos: llega su informe de fin de llamada. */
  async function finishCall(minutes: number): Promise<string> {
    const callId = newCallId();
    expect((await endOfCall(callId, minutes)).statusCode).toBe(200);
    return callId;
  }

  const callLogIdOf = (providerCallId: string): Promise<string> =>
    world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      const log = await prisma.voiceCallLog.findUniqueOrThrow({ where: { providerCallId } });
      return log.id;
    });

  const readUsage = async (): Promise<{ usedMinutes: number; includedMinutes: number }> =>
    (await asOwner('GET', '/voice-receptionist/usage')).json<{
      usage: { usedMinutes: number; includedMinutes: number };
    }>().usage;

  const listNotices = async (): Promise<Notice[]> =>
    (await asOwner('GET', '/notifications')).json<{ notifications: Notice[] }>().notifications;

  const voiceNotices = async (): Promise<Notice[]> =>
    (await listNotices()).filter((notice) => notice.kind.startsWith('voice_minutes'));

  const readOverview = async () =>
    (await asOwner('GET', '/voice-receptionist')).json<{
      isEnabled: boolean;
      subscription: { status: string; includedMinutes: number; periodStart: string } | null;
    }>();

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [{ token: EMAIL_SENDER, value: emailSender }],
    });
    world = new BookingWorld(application);
    gateway = application.get<FakeBillingGateway>(BILLING_GATEWAY);
    sweeper = application.get(VoiceOverageReportSweeper);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    emailSender.sent.length = 0;
    gateway.attachedVoiceSubscriptionIds.length = 0;
    gateway.subscriptionIdsWithVoiceAddonLine.clear();
    gateway.checkoutRequests.length = 0;
    gateway.voiceTierChanges.length = 0;
    gateway.detachedVoiceItemIds.length = 0;
    gateway.reportedVoiceOverages.length = 0;
    gateway.isVoiceOverageReportFailing = false;
    gateway.voiceBillingPeriod = {
      periodStart: new Date(Date.now() - 10 * DAY_MS),
      periodEnd: new Date(Date.now() + 20 * DAY_MS),
    };
    adminUserId = await world.fixtures.createUser('platform-admin');
    await grantPlatformRoleAsOwner(adminUserId, 'admin');
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId, 'Studio Norte');
    centerId = center.centerId;
    customerId = `cus_fake_${centerId}`;
    await application.get(SyncStripePlansUseCase).execute();
    await setCenterColumns(
      `"stripe_customer_id" = '${customerId}', "stripe_subscription_id" = '${SUBSCRIPTION_ID}'`,
    );
  });

  afterAll(async () => {
    await application.close();
  });

  describe('billing:setup', () => {
    it('stores the Stripe prices of every tier of the add-on', async () => {
      const prices = await world.tenantPrismaService.runInBillingContext((prisma) =>
        prisma.voiceAddonPlan.findMany({ orderBy: { planId: 'asc' } }),
      );

      expect(
        prices.map((tier) => [tier.planId, tier.stripeMonthlyPriceId, tier.stripeOveragePriceId]),
      ).toEqual([
        ['basic', 'price_fake_voice_basic_monthly', 'price_fake_voice_basic_overage'],
        ['premium', 'price_fake_voice_premium_monthly', 'price_fake_voice_premium_overage'],
        ['pro', 'price_fake_voice_pro_monthly', 'price_fake_voice_pro_overage'],
      ]);
    });
  });

  describe('attaching the add-on to the subscription of the center', () => {
    it('adds it as lines of the subscription the center already has and follows its billing period', async () => {
      await provisionWithBilling();

      expect(gateway.attachedVoiceSubscriptionIds).toEqual([SUBSCRIPTION_ID]);
      const { subscription } = await readOverview();
      expect(subscription).toMatchObject({
        status: 'active',
        includedMinutes: INCLUDED_MINUTES,
        periodStart: gateway.voiceBillingPeriod?.periodStart.toISOString(),
      });
      const stored = await world.tenantPrismaService.runInBillingContext((prisma) =>
        prisma.voiceReceptionistSubscription.findUniqueOrThrow({ where: { centerId } }),
      );
      expect(stored).toMatchObject({
        stripeSubscriptionItemId: `si_fake_voice_${SUBSCRIPTION_ID}`,
        stripeOverageItemId: `si_fake_voice_overage_${SUBSCRIPTION_ID}`,
      });
    });

    it('takes the included minutes of the plan of the center when none are given', async () => {
      expect(
        await provision({
          bridgeNumber: BRIDGE_NUMBER,
          provider: 'fake',
          shouldBillWithStripe: true,
        }),
      ).toBe(204);

      expect((await readOverview()).subscription?.includedMinutes).toBe(250);
    });

    it('refuses while the center has no subscription in Stripe', async () => {
      await setCenterColumns(`"stripe_subscription_id" = null`);

      const status = await provision({
        bridgeNumber: BRIDGE_NUMBER,
        provider: 'fake',
        shouldBillWithStripe: true,
      });

      expect(status).toBe(409);
      expect(gateway.attachedVoiceSubscriptionIds).toEqual([]);
      expect((await readOverview()).subscription).toBeNull();
    });

    it('refuses a center that pays its plan by the year, whose subscription cannot take monthly lines', async () => {
      await setCenterColumns(`"billing_period" = 'annual'`);

      const status = await provision({
        bridgeNumber: BRIDGE_NUMBER,
        provider: 'fake',
        shouldBillWithStripe: true,
      });

      expect(status).toBe(409);
      expect(gateway.attachedVoiceSubscriptionIds).toEqual([]);
    });

    it('refuses while billing:setup has not created the add-on prices', async () => {
      await world.tenantPrismaService.runInBillingContext((prisma) =>
        prisma.voiceAddonPlan.updateMany({
          data: { stripeMonthlyPriceId: null, stripeOveragePriceId: null },
        }),
      );

      const status = await provision({
        bridgeNumber: BRIDGE_NUMBER,
        provider: 'fake',
        shouldBillWithStripe: true,
      });

      expect(status).toBe(409);
    });

    it('is a pilot, with nothing billed, unless asked to bill with Stripe', async () => {
      expect(await provision({ bridgeNumber: BRIDGE_NUMBER, provider: 'fake' })).toBe(204);

      expect(gateway.attachedVoiceSubscriptionIds).toEqual([]);
    });

    it('takes the lines off the subscription and switches the bot off when the add-on is cancelled', async () => {
      await provisionWithBilling();

      const response = await world.call('DELETE', platformUrl(), adminUserId);

      expect(response.statusCode).toBe(204);
      expect(gateway.detachedVoiceItemIds).toEqual([`si_fake_voice_${SUBSCRIPTION_ID}`]);
      expect(await readOverview()).toMatchObject({
        isEnabled: false,
        subscription: { status: 'cancelled' },
      });
    });

    it('hides the platform route from the owner of the center: only the platform administration adds or removes it', async () => {
      const asOwnerOfTheCenter = await world.call('PUT', platformUrl(), ownerUserId, {
        body: { bridgeNumber: BRIDGE_NUMBER, provider: 'fake' },
      });

      expect(asOwnerOfTheCenter.statusCode).toBe(404);
    });
  });

  describe('choosing the add-on on the payment page of the plan', () => {
    const sendCheckoutCompleted = (
      overrides: { period?: 'monthly' | 'annual'; eventId?: string } = {},
    ) => {
      eventCounter += 1;
      return world.call('POST', '/v1/webhooks/stripe', undefined, {
        headers: { 'stripe-signature': FAKE_SIGNATURE },
        body: {
          billingEvent: {
            type: 'checkout_completed',
            eventId: overrides.eventId ?? `evt_checkout_${String(eventCounter)}`,
            centerId,
            planId: 'pro',
            period: overrides.period ?? 'monthly',
            customerId,
            subscriptionId: SUBSCRIPTION_ID,
          },
        },
      });
    };

    const openPaymentLink = async (period: 'monthly' | 'annual') => {
      const link = await application
        .get(PlanPaymentLinkService)
        .buildUrl({ centerId, planId: 'pro', period });
      const response = await world.call('GET', `/v1/billing/pay${new URL(link).search}`, undefined);
      expect(response.statusCode).toBe(302);
      return gateway.checkoutRequests.at(-1);
    };

    const countVoiceSubscriptions = (): Promise<number> =>
      world.tenantPrismaService.runInBillingContext((prisma) =>
        prisma.voiceReceptionistSubscription.count({ where: { centerId } }),
      );

    it('offers the add-on of the plan tier as an option on the monthly payment page only', async () => {
      const monthly = await openPaymentLink('monthly');
      const annual = await openPaymentLink('annual');

      expect(monthly?.voiceAddonPriceId).toBe('price_fake_voice_pro_monthly');
      expect(annual?.voiceAddonPriceId).toBeNull();
    });

    it('does not offer it before billing:setup has created the prices of the add-on', async () => {
      await world.tenantPrismaService.runInBillingContext((prisma) =>
        prisma.voiceAddonPlan.updateMany({
          data: { stripeMonthlyPriceId: null, stripeOveragePriceId: null },
        }),
      );

      expect((await openPaymentLink('monthly'))?.voiceAddonPriceId).toBeNull();
    });

    it('signs the center up with the minutes of its plan when the owner took the add-on', async () => {
      gateway.subscriptionIdsWithVoiceAddonLine.add(SUBSCRIPTION_ID);

      expect((await sendCheckoutCompleted()).statusCode).toBe(204);

      expect(gateway.attachedVoiceSubscriptionIds).toEqual([SUBSCRIPTION_ID]);
      const { subscription, isEnabled } = await readOverview();
      expect(subscription).toMatchObject({ status: 'active', includedMinutes: 250 });
      // El número puente lo asigna la plataforma después: hasta entonces el bot sigue apagado.
      expect(isEnabled).toBe(false);
    });

    it('completes it once, even when Stripe repeats the notice or sends a second one', async () => {
      gateway.subscriptionIdsWithVoiceAddonLine.add(SUBSCRIPTION_ID);

      await sendCheckoutCompleted({ eventId: 'evt_checkout_same' });
      await sendCheckoutCompleted({ eventId: 'evt_checkout_same' });
      expect(gateway.attachedVoiceSubscriptionIds).toHaveLength(1);

      await sendCheckoutCompleted();
      expect(await countVoiceSubscriptions()).toBe(1);
    });

    it('creates nothing when the owner took the plan without the add-on', async () => {
      expect((await sendCheckoutCompleted()).statusCode).toBe(204);

      expect(gateway.attachedVoiceSubscriptionIds).toEqual([]);
      expect(await countVoiceSubscriptions()).toBe(0);
    });

    it('creates nothing for a plan paid by the year', async () => {
      gateway.subscriptionIdsWithVoiceAddonLine.add(SUBSCRIPTION_ID);

      await sendCheckoutCompleted({ period: 'annual' });

      expect(await countVoiceSubscriptions()).toBe(0);
    });

    it('still reprices when the center changes plan after contracting it that way', async () => {
      gateway.subscriptionIdsWithVoiceAddonLine.add(SUBSCRIPTION_ID);
      await sendCheckoutCompleted();

      await sendSubscriptionChanged({
        planId: 'premium',
        voiceAddon: voiceAddonPeriod(...currentPeriod()),
      });

      expect((await readOverview()).subscription?.includedMinutes).toBe(400);
      expect(gateway.voiceTierChanges).toEqual([
        {
          itemId: `si_fake_voice_${SUBSCRIPTION_ID}`,
          monthlyPriceId: 'price_fake_voice_premium_monthly',
        },
      ]);
    });
  });

  describe('following the subscription of Stripe', () => {
    beforeEach(async () => {
      await provisionWithBilling();
    });

    const identifyAnswer = async (): Promise<Record<string, unknown>> =>
      (await callTool('identify-caller', {}, { callId: newCallId() })).result;

    it('stops answering while the payment fails and answers again when it is fixed', async () => {
      expect(await identifyAnswer()).toMatchObject({ ok: true });

      await sendSubscriptionChanged({
        status: 'past_due',
        voiceAddon: voiceAddonPeriod(...currentPeriod()),
      });
      const paused = await identifyAnswer();
      expect((await readOverview()).subscription?.status).toBe('paused');

      await sendSubscriptionChanged({
        status: 'active',
        voiceAddon: voiceAddonPeriod(...currentPeriod()),
      });
      const resumed = await identifyAnswer();

      expect(paused).toMatchObject({ ok: false, reason: 'subscription_not_active' });
      expect(resumed).toMatchObject({ ok: true });
      expect((await readOverview()).subscription?.status).toBe('active');
    });

    it('cancels the add-on and switches the center off when the add-on lines leave the subscription', async () => {
      await sendSubscriptionChanged({
        voiceAddon: { isPresent: false, periodStart: null, periodEnd: null },
      });

      expect(await readOverview()).toMatchObject({
        isEnabled: false,
        subscription: { status: 'cancelled' },
      });
      expect(await identifyAnswer()).toMatchObject({ ok: false });
    });

    it('cancels the add-on when the whole subscription is canceled', async () => {
      await sendSubscriptionChanged({ status: 'canceled' });

      expect((await readOverview()).subscription?.status).toBe('cancelled');
    });

    it('moves to the minutes and the price of the new plan when the center changes plan, and back', async () => {
      await sendSubscriptionChanged({
        planId: 'premium',
        voiceAddon: voiceAddonPeriod(...currentPeriod()),
      });

      expect((await readOverview()).subscription?.includedMinutes).toBe(400);
      expect(gateway.voiceTierChanges).toEqual([
        {
          itemId: `si_fake_voice_${SUBSCRIPTION_ID}`,
          monthlyPriceId: 'price_fake_voice_premium_monthly',
        },
      ]);

      await sendSubscriptionChanged({
        planId: 'basic',
        voiceAddon: voiceAddonPeriod(...currentPeriod()),
      });

      expect((await readOverview()).subscription?.includedMinutes).toBe(150);
      expect(gateway.voiceTierChanges.at(-1)).toEqual({
        itemId: `si_fake_voice_${SUBSCRIPTION_ID}`,
        monthlyPriceId: 'price_fake_voice_basic_monthly',
      });
    });

    it('lets the capabilities of the bot follow the plan too, with no extra step', async () => {
      await sendSubscriptionChanged({
        planId: 'basic',
        voiceAddon: voiceAddonPeriod(...currentPeriod()),
      });

      const overview = await asOwner('GET', '/voice-receptionist');

      expect(overview.json<{ capabilities: { canJoinWaitlist: boolean } }>().capabilities).toEqual(
        expect.objectContaining({ canJoinWaitlist: false }),
      );
    });

    it('does not reprice twice for the same notice, even if Stripe sends it again', async () => {
      const body = {
        billingEvent: {
          type: 'subscription_changed',
          eventId: 'evt_same',
          customerId,
          subscriptionId: SUBSCRIPTION_ID,
          status: 'active',
          period: 'monthly',
          planId: 'premium',
          voiceAddon: voiceAddonPeriod(...currentPeriod()),
        },
      };
      const send = () =>
        world.call('POST', '/v1/webhooks/stripe', undefined, {
          headers: { 'stripe-signature': FAKE_SIGNATURE },
          body,
        });

      await send();
      await send();

      expect(gateway.voiceTierChanges).toHaveLength(1);
    });
  });

  describe('counting the excess minutes', () => {
    it('reports to the meter only the minutes beyond the included ones, once per call', async () => {
      await provisionWithBilling();
      await finishCall(6);
      const crossing = await finishCall(7);
      const over = await finishCall(2);

      expect(gateway.reportedVoiceOverages.map((reported) => reported.minutes)).toEqual([3, 2]);
      expect(gateway.reportedVoiceOverages.map((reported) => reported.identifier)).toEqual([
        `yoclick-voice-overage-${await callLogIdOf(crossing)}`,
        `yoclick-voice-overage-${await callLogIdOf(over)}`,
      ]);
      expect(gateway.reportedVoiceOverages[0]?.customerId).toBe(customerId);
      expect(await readUsage()).toMatchObject({ usedMinutes: 15, includedMinutes: 10 });
    });

    it('reports nothing for a call inside the included minutes', async () => {
      await provisionWithBilling();

      await finishCall(4);
      await finishCall(6);

      expect(gateway.reportedVoiceOverages).toEqual([]);
    });

    it('never counts a call twice when the provider repeats its end-of-call report', async () => {
      await provisionWithBilling();
      const callId = await finishCall(12);

      await endOfCall(callId, 12);
      await endOfCall(callId, 12);
      await sweeper.sweep();

      expect(gateway.reportedVoiceOverages).toHaveLength(1);
      expect(gateway.reportedVoiceOverages[0]?.minutes).toBe(2);
      expect((await readUsage()).usedMinutes).toBe(12);
    });

    it('keeps the excess pending when Stripe fails and reports it, once, in the next sweep', async () => {
      await provisionWithBilling();
      gateway.isVoiceOverageReportFailing = true;

      const callId = await finishCall(13);
      expect(gateway.reportedVoiceOverages).toEqual([]);

      gateway.isVoiceOverageReportFailing = false;
      const firstSweep = await sweeper.sweep();
      const secondSweep = await sweeper.sweep();

      expect(firstSweep).toEqual({ reportedCalls: 1, failedCalls: 0 });
      expect(secondSweep).toEqual({ reportedCalls: 0, failedCalls: 0 });
      expect(gateway.reportedVoiceOverages).toEqual([
        expect.objectContaining({
          minutes: 3,
          identifier: `yoclick-voice-overage-${await callLogIdOf(callId)}`,
        }),
      ]);
    });

    it('lets a repeated end-of-call report retry a report that failed, still without a double count', async () => {
      await provisionWithBilling();
      gateway.isVoiceOverageReportFailing = true;
      const callId = await finishCall(11);
      gateway.isVoiceOverageReportFailing = false;

      await endOfCall(callId, 11);

      expect(gateway.reportedVoiceOverages).toHaveLength(1);
      expect((await readUsage()).usedMinutes).toBe(11);
    });

    it('bills nothing for a pilot center that has no Stripe lines', async () => {
      expect(
        await provision({
          bridgeNumber: BRIDGE_NUMBER,
          provider: 'fake',
          includedMinutes: INCLUDED_MINUTES,
        }),
      ).toBe(204);
      await asOwner('POST', '/voice-receptionist/enable');

      await finishCall(30);
      await sweeper.sweep();

      expect(gateway.reportedVoiceOverages).toEqual([]);
      expect((await readUsage()).usedMinutes).toBe(30);
    });

    it('starts counting from zero when the billing period rolls over', async () => {
      await provisionWithBilling();
      await finishCall(9);

      await sendSubscriptionChanged({
        voiceAddon: voiceAddonPeriod(
          new Date(Date.now() - 60_000),
          new Date(Date.now() + 30 * DAY_MS),
        ),
      });

      expect(await readUsage()).toMatchObject({
        usedMinutes: 0,
        includedMinutes: INCLUDED_MINUTES,
      });
      await finishCall(4);
      expect(gateway.reportedVoiceOverages).toEqual([]);
    });
  });

  describe('alerts at 80 % and 100 % of the included minutes', () => {
    it('warns once at each threshold, in the app and by email to the owner', async () => {
      await provisionWithBilling();

      await finishCall(5);
      expect(await voiceNotices()).toEqual([]);

      await finishCall(3);
      const atEighty = await voiceNotices();
      await finishCall(1);
      await finishCall(1);
      const atHundred = await voiceNotices();
      await finishCall(5);
      const afterwards = await voiceNotices();

      expect(atEighty.map((notice) => notice.kind)).toEqual(['voice_minutes_80']);
      expect(atEighty[0]?.data).toEqual({ usedMinutes: '8', includedMinutes: '10' });
      expect(atHundred.map((notice) => notice.kind).sort(compareText)).toEqual([
        'voice_minutes_100',
        'voice_minutes_80',
      ]);
      expect(afterwards).toHaveLength(2);
      expect(emailSender.sent.map((message) => message.subject)).toEqual([
        'El Contestador IA de Studio Norte ha usado el 80 % de sus minutos',
        'El Contestador IA de Studio Norte ha usado todos sus minutos',
      ]);
    });

    it('warns of both thresholds when one call crosses them together, once', async () => {
      await provisionWithBilling();

      await finishCall(12);

      expect((await voiceNotices()).map((notice) => notice.kind).sort(compareText)).toEqual([
        'voice_minutes_100',
        'voice_minutes_80',
      ]);
    });

    it('does not repeat an alert when the provider repeats the end-of-call report', async () => {
      await provisionWithBilling();
      const callId = await finishCall(9);

      await endOfCall(callId, 9);

      expect(await voiceNotices()).toHaveLength(1);
      expect(emailSender.sent).toHaveLength(1);
    });

    it('also tells the administration of the center, not only the owner', async () => {
      const administrator = await world.addMember(centerId, 'administrator', 'admin');
      await provisionWithBilling();

      await finishCall(9);

      const response = await world.call('GET', url('/notifications'), administrator.userId, {
        centerId,
      });
      expect(
        response.json<{ notifications: Notice[] }>().notifications.map((notice) => notice.kind),
      ).toContain('voice_minutes_80');
    });

    it('warns again in the next period', async () => {
      await provisionWithBilling();
      await finishCall(9);
      await sendSubscriptionChanged({
        voiceAddon: voiceAddonPeriod(
          new Date(Date.now() - 60_000),
          new Date(Date.now() + 30 * DAY_MS),
        ),
      });

      await finishCall(9);

      expect(
        (await voiceNotices()).filter((notice) => notice.kind === 'voice_minutes_80'),
      ).toHaveLength(2);
    });

    it('keeps prices and purchase wording out of the notice and the push, and puts them in the email', async () => {
      await provisionWithBilling();

      await finishCall(10);

      const notices = await voiceNotices();
      expect(JSON.stringify(notices)).not.toMatch(/€|precio|contrat/i);
      const emailAtHundred = emailSender.sent.find((message) => message.subject.includes('todos'));
      expect(emailAtHundred?.textBody).toContain('0,35 € por minuto (IVA no incluido)');
    });
  });

  describe('what the bot does when the included minutes run out', () => {
    const identifyAnswer = async (): Promise<Record<string, unknown>> =>
      (await callTool('identify-caller', {}, { callId: newCallId() })).result;

    it('keeps answering and charging the excess by default', async () => {
      await provisionWithBilling();
      await finishCall(15);

      expect(await identifyAnswer()).toMatchObject({ ok: true });
    });

    it('stops answering when the center chose to switch the bot off, and the line rings as usual', async () => {
      await provisionWithBilling();
      await asOwner('PUT', '/voice-receptionist/config', { overagePolicy: 'disable_bot' });
      expect(await identifyAnswer()).toMatchObject({ ok: true });

      await finishCall(10);
      const exhausted = await identifyAnswer();

      expect(exhausted).toMatchObject({
        ok: false,
        reason: 'included_minutes_exhausted',
        shouldTransfer: true,
      });
    });

    it('answers again when the owner changes the option, and when the next period starts', async () => {
      await provisionWithBilling();
      await asOwner('PUT', '/voice-receptionist/config', { overagePolicy: 'disable_bot' });
      await finishCall(10);
      expect(await identifyAnswer()).toMatchObject({ ok: false });

      await asOwner('PUT', '/voice-receptionist/config', { overagePolicy: 'continue_and_charge' });
      expect(await identifyAnswer()).toMatchObject({ ok: true });

      await asOwner('PUT', '/voice-receptionist/config', { overagePolicy: 'disable_bot' });
      expect(await identifyAnswer()).toMatchObject({ ok: false });
      await sendSubscriptionChanged({
        voiceAddon: voiceAddonPeriod(
          new Date(Date.now() - 60_000),
          new Date(Date.now() + 30 * DAY_MS),
        ),
      });

      expect(await identifyAnswer()).toMatchObject({ ok: true });
    });

    it('does not report an excess for the call that used the last included minutes', async () => {
      await provisionWithBilling();
      await asOwner('PUT', '/voice-receptionist/config', { overagePolicy: 'disable_bot' });

      await finishCall(10);

      expect(gateway.reportedVoiceOverages).toEqual([]);
    });

    it('shows the option in the settings of the panel, continuing and charging by default', async () => {
      await provisionWithBilling();

      const overview = await asOwner('GET', '/voice-receptionist');

      expect(overview.json<{ config: { overagePolicy: string } }>().config.overagePolicy).toBe(
        'continue_and_charge',
      );
    });
  });

  describe('cap on wrong student codes for a whole center', () => {
    const wrongCode = '000000';

    beforeEach(async () => {
      await provisionWithBilling();
    });

    const distinctCaller = (attempt: number): string => `+34600${String(100_000 + attempt)}`;

    const tryCode = (code: string, caller: string) =>
      callTool('identify-caller', { studentCode: code }, { callId: newCallId(), caller });

    it('hands the call to a person, without testing the code, once many numbers have failed in the hour', async () => {
      const client = await world.addMember(centerId, 'ana', 'client');
      const studentCode = (
        await world.call('GET', url('/me/student-code'), client.userId, { centerId })
      ).json<{ code: string }>().code;
      const code = studentCode === wrongCode ? '111111' : wrongCode;

      for (let attempt = 0; attempt < CENTER_CODE_FAILURES_PER_HOUR; attempt += 1) {
        const reply = await tryCode(code, distinctCaller(attempt));
        expect(reply.result).toMatchObject({ reason: 'code_not_found' });
      }
      const withTheRightCode = await tryCode(studentCode, '+34600111999');

      expect(withTheRightCode.result).toMatchObject({
        ok: false,
        reason: 'too_many_attempts',
        shouldTransfer: true,
      });
    });

    it('does not count a right code, so the center keeps identifying its students', async () => {
      const client = await world.addMember(centerId, 'ana', 'client');
      const studentCode = (
        await world.call('GET', url('/me/student-code'), client.userId, { centerId })
      ).json<{ code: string }>().code;
      const code = studentCode === wrongCode ? '111111' : wrongCode;
      for (let attempt = 0; attempt < CENTER_CODE_FAILURES_PER_HOUR - 1; attempt += 1) {
        await tryCode(code, distinctCaller(attempt));
      }

      const stillWorks = await tryCode(studentCode, '+34600111888');

      expect(stillWorks.result).toMatchObject({ ok: true, identified: true });
    });
  });
});
