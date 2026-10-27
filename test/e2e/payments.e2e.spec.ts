import { v7 as generateUuidV7 } from 'uuid';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PAYMENT_GATEWAY } from '../../src/modules/payments/application/ports/payment-gateway';
import { FakePaymentGateway } from '../../src/modules/payments/infrastructure/fake-payment-gateway';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface Person {
  userId: string;
  membershipId: string;
}

interface PassBody {
  id: string;
  status: string;
}

interface SheetBody {
  paymentId: string;
  clientSecret: string;
  publishableKey: string;
  connectedAccountId: string;
  amountCents: number;
}

const PASS_PRICE_CENTS = 5000;
const WEBHOOK_SIGNATURE = 'fake-signature';

describe('payments (Stripe Connect, plan Premium)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let gateway: FakePaymentGateway;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let ana: Person;
  let luis: Person;
  let rateId: string;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  async function setPlan(planId: 'basic' | 'premium'): Promise<void> {
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.center.update({ where: { id: centerId }, data: { planId } });
    });
  }

  async function readStatus(userId: string): Promise<string> {
    const response = await world.call('GET', url('/payments/status'), userId, { centerId });
    return response.json<{ status: string }>().status;
  }

  /** Deja el centro cobrando: Premium y con el alta de Stripe terminada. */
  async function fillFiscalData(): Promise<void> {
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.center.update({
        where: { id: centerId },
        data: {
          legalName: 'Academia Ninja SL',
          taxId: 'B12345678',
          taxAddress: 'Calle Mayor 1, 28013 Madrid',
        },
      });
    });
  }

  async function makeCenterReadyToCharge(): Promise<void> {
    await setPlan('premium');
    await fillFiscalData();
    const link = await world.call('POST', url('/payments/connect/onboarding-link'), ownerUserId, {
      centerId,
    });
    expect(link.statusCode).toBe(201);
    const account = await world.tenantPrismaService.runInTenantContext(
      ownerActor(),
      async (prisma) =>
        prisma.center.findFirstOrThrow({
          where: { id: centerId },
          select: { stripeAccountId: true },
        }),
    );
    gateway.completeOnboarding(account.stripeAccountId ?? '');
    expect(await readStatus(ownerUserId)).toBe('ready');
  }

  async function requestPass(client: Person): Promise<PassBody> {
    const response = await world.call('POST', url(`/rates/${rateId}/request`), client.userId, {
      centerId,
    });
    expect(response.statusCode).toBe(201);
    return response.json<PassBody>();
  }

  async function payPass(client: Person, passId: string) {
    return world.call('POST', url(`/passes/${passId}/pay`), client.userId, { centerId });
  }

  async function readPaymentIntentId(paymentId: string): Promise<string> {
    const payment = await world.tenantPrismaService.runInTenantContext(
      ownerActor(),
      async (prisma) => prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    );
    return payment.stripePaymentIntentId;
  }

  async function readPassStatus(client: Person, passId: string): Promise<string | undefined> {
    const response = await world.call('GET', url('/passes/mine'), client.userId, { centerId });
    return response.json<{ passes: PassBody[] }>().passes.find(({ id }) => id === passId)?.status;
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
    gateway = application.get<FakePaymentGateway>(PAYMENT_GATEWAY);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    centerId = center.centerId;
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.center.update({
        where: { id: centerId },
        data: { contactEmail: 'contacto@academia.test' },
      });
    });
    ana = await world.addMember(centerId, 'ana', 'client');
    luis = await world.addMember(centerId, 'luis', 'client');
    const rate = await world.call('POST', url('/rates'), ownerUserId, {
      centerId,
      body: { name: 'Bono 10', sessionsCount: 10, validDays: 30, priceCents: PASS_PRICE_CENTS },
    });
    rateId = rate.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await application.close();
  });

  it('keeps online payments out of plans below Premium', async () => {
    await setPlan('basic');

    expect(await readStatus(ownerUserId)).toBe('not_included');
    const link = await world.call('POST', url('/payments/connect/onboarding-link'), ownerUserId, {
      centerId,
    });
    expect(link.statusCode).toBe(403);
    expect(link.json<{ code: string }>().code).toBe('PAYMENTS_NOT_INCLUDED');

    const pass = await requestPass(ana);
    const payment = await payPass(ana, pass.id);
    expect(payment.statusCode).toBe(403);
    expect(await readPassStatus(ana, pass.id)).toBe('pending');
  });

  it('walks a Premium center through the Stripe sign-up until it can charge', async () => {
    await setPlan('premium');
    await fillFiscalData();
    expect(await readStatus(ownerUserId)).toBe('not_started');

    const link = await world.call('POST', url('/payments/connect/onboarding-link'), ownerUserId, {
      centerId,
    });
    expect(link.statusCode).toBe(201);
    expect(link.json<{ url: string }>().url).toContain('onboarding');
    expect(await readStatus(ownerUserId)).toBe('pending');

    const pass = await requestPass(ana);
    const tooEarly = await payPass(ana, pass.id);
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json<{ code: string }>().code).toBe('PAYMENTS_NOT_READY');
  });

  it('asks for a contact email before opening the Stripe account', async () => {
    await setPlan('premium');
    await fillFiscalData();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.center.update({ where: { id: centerId }, data: { contactEmail: null } });
    });

    const link = await world.call('POST', url('/payments/connect/onboarding-link'), ownerUserId, {
      centerId,
    });

    expect(link.statusCode).toBe(422);
    expect(link.json<{ code: string }>().code).toBe('CENTER_CONTACT_EMAIL_REQUIRED');
    expect(await readStatus(ownerUserId)).toBe('not_started');
  });

  it('gives the owner a link to the Stripe dashboard only once the center can charge', async () => {
    await setPlan('premium');
    const tooEarly = await world.call(
      'POST',
      url('/payments/connect/dashboard-link'),
      ownerUserId,
      {
        centerId,
      },
    );
    expect(tooEarly.statusCode).toBe(409);

    await makeCenterReadyToCharge();
    const link = await world.call('POST', url('/payments/connect/dashboard-link'), ownerUserId, {
      centerId,
    });
    expect(link.statusCode).toBe(201);
    expect(link.json<{ url: string }>().url).toContain('dashboard');

    const byClient = await world.call('POST', url('/payments/connect/dashboard-link'), ana.userId, {
      centerId,
    });
    expect(byClient.statusCode).toBe(403);
  });

  it('activates a pass once Stripe says it was paid, and only for its owner', async () => {
    await makeCenterReadyToCharge();
    const pass = await requestPass(ana);

    const stranger = await payPass(luis, pass.id);
    expect(stranger.statusCode).toBe(404);

    const first = await payPass(ana, pass.id);
    expect(first.statusCode).toBe(201);
    const sheet = first.json<SheetBody>();
    expect(sheet.amountCents).toBe(PASS_PRICE_CENTS);
    expect(sheet.publishableKey).toBe('pk_test_fake');
    const retry = await payPass(ana, pass.id);
    expect(retry.json<SheetBody>().paymentId).toBe(sheet.paymentId);

    const unpaid = await world.call(
      'POST',
      url(`/payments/${sheet.paymentId}/confirm`),
      ana.userId,
      {
        centerId,
      },
    );
    expect(unpaid.json<{ status: string }>().status).toBe('pending');
    expect(await readPassStatus(ana, pass.id)).toBe('pending');

    gateway.succeed(await readPaymentIntentId(sheet.paymentId));
    const paid = await world.call('POST', url(`/payments/${sheet.paymentId}/confirm`), ana.userId, {
      centerId,
    });
    expect(paid.json<{ status: string }>().status).toBe('succeeded');
    expect(await readPassStatus(ana, pass.id)).toBe('active');

    const again = await world.call(
      'POST',
      url(`/payments/${sheet.paymentId}/confirm`),
      ana.userId,
      {
        centerId,
      },
    );
    expect(again.json<{ status: string }>().status).toBe('succeeded');
  });

  it('activates a pass from the Stripe webhook and refuses a bad signature', async () => {
    await makeCenterReadyToCharge();
    const pass = await requestPass(ana);
    const sheet = (await payPass(ana, pass.id)).json<SheetBody>();
    const paymentIntentId = await readPaymentIntentId(sheet.paymentId);
    gateway.succeed(paymentIntentId);
    // Cobro directo: Stripe avisa con un evento Connect, que trae la cuenta del centro.
    const event = {
      type: 'payment_intent.succeeded',
      paymentIntentId,
      accountId: sheet.connectedAccountId,
    };

    const forged = await world.call('POST', '/v1/webhooks/stripe', undefined, {
      headers: { 'stripe-signature': 'forged' },
      body: event,
    });
    expect(forged.statusCode).toBe(400);
    expect(await readPassStatus(ana, pass.id)).toBe('pending');

    const delivered = await world.call('POST', '/v1/webhooks/stripe', undefined, {
      headers: { 'stripe-signature': WEBHOOK_SIGNATURE },
      body: event,
    });
    expect(delivered.statusCode).toBe(204);
    expect(await readPassStatus(ana, pass.id)).toBe('active');
  });

  describe('refunds made from the Stripe dashboard', () => {
    interface PaidPass {
      passId: string;
      paymentId: string;
      sheet: SheetBody;
      paymentIntentId: string;
    }

    async function deliverWebhook(event: {
      type: string;
      paymentIntentId: string;
      sheet: SheetBody;
    }): Promise<void> {
      const delivered = await world.call('POST', '/v1/webhooks/stripe', undefined, {
        headers: { 'stripe-signature': WEBHOOK_SIGNATURE },
        body: {
          type: event.type,
          paymentIntentId: event.paymentIntentId,
          accountId: event.sheet.connectedAccountId,
        },
      });
      expect(delivered.statusCode).toBe(204);
    }

    async function payAndSettle(): Promise<PaidPass> {
      await makeCenterReadyToCharge();
      const pass = await requestPass(ana);
      const sheet = (await payPass(ana, pass.id)).json<SheetBody>();
      const paymentIntentId = await readPaymentIntentId(sheet.paymentId);
      gateway.succeed(paymentIntentId);
      await deliverWebhook({ type: 'payment_intent.succeeded', paymentIntentId, sheet });
      return { passId: pass.id, paymentId: sheet.paymentId, sheet, paymentIntentId };
    }

    async function readListedRefund(paymentId: string): Promise<number | undefined> {
      const response = await world.call('GET', url('/payments'), ownerUserId, { centerId });
      return response
        .json<{ payments: { id: string; refundedCents: number }[] }>()
        .payments.find(({ id }) => id === paymentId)?.refundedCents;
    }

    it('shows a partial refund and keeps the pass', async () => {
      const paid = await payAndSettle();
      gateway.refund({ paymentIntentId: paid.paymentIntentId, refundedCents: 2000 });

      await deliverWebhook({
        type: 'charge.refunded',
        paymentIntentId: paid.paymentIntentId,
        sheet: paid.sheet,
      });

      expect(await readListedRefund(paid.paymentId)).toBe(2000);
      expect(await readPassStatus(ana, paid.passId)).toBe('active');
    });

    describe('bookings of a fully refunded pass', () => {
      let teacher: Person;

      async function insertUpcomingBooking(client: Person): Promise<string> {
        const service = await world.createService(ownerUserId, centerId, {
          name: 'Karate',
          durationMinutes: 60,
        });
        const startsAt = new Date(Date.now() + 5 * 60_000);
        const sessionId = generateUuidV7();
        const bookingId = generateUuidV7();
        await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
          await prisma.classSession.create({
            data: {
              id: sessionId,
              centerId,
              serviceId: service.id,
              staffMembershipId: teacher.membershipId,
              startsAt,
              endsAt: new Date(startsAt.getTime() + 60 * 60_000),
            },
          });
          await prisma.booking.create({
            data: {
              id: bookingId,
              centerId,
              classSessionId: sessionId,
              clientMembershipId: client.membershipId,
            },
          });
        });
        return bookingId;
      }

      async function refundEverything(paid: PaidPass): Promise<void> {
        gateway.refund({ paymentIntentId: paid.paymentIntentId, refundedCents: PASS_PRICE_CENTS });
        await deliverWebhook({
          type: 'charge.refunded',
          paymentIntentId: paid.paymentIntentId,
          sheet: paid.sheet,
        });
      }

      const confirmAttendance = async (bookingId: string) =>
        world.call('POST', url(`/bookings/${bookingId}/attendance`), teacher.userId, {
          centerId,
        });

      beforeEach(async () => {
        teacher = await world.addMember(centerId, 'teacher', 'staff');
      });

      it('keeps the booking but flags it and refuses attendance until a new pass is used', async () => {
        const paid = await payAndSettle();
        const bookingId = await insertUpcomingBooking(ana);
        await refundEverything(paid);

        const mine = await world.call('GET', url('/bookings/mine'), ana.userId, { centerId });
        const [booking] = mine.json<{ bookings: { id: string; needsNewPass: boolean }[] }>()
          .bookings;
        expect(booking).toMatchObject({ id: bookingId, needsNewPass: true });
        const blocked = await confirmAttendance(bookingId);
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json<{ code: string }>().code).toBe('PASS_REQUIRED');

        await world.call('POST', url('/passes/assign'), ownerUserId, {
          centerId,
          body: { rateId, clientMembershipId: ana.membershipId },
        });
        const again = await world.call('GET', url('/bookings/mine'), ana.userId, { centerId });
        expect(again.json<{ bookings: { needsNewPass: boolean }[] }>().bookings[0]).toMatchObject({
          needsNewPass: false,
        });
        expect((await confirmAttendance(bookingId)).statusCode).toBe(200);
      });

      it('does not block bookings made after the refund', async () => {
        const paid = await payAndSettle();
        await refundEverything(paid);

        const laterBookingId = await insertUpcomingBooking(ana);

        const mine = await world.call('GET', url('/bookings/mine'), ana.userId, { centerId });
        expect(mine.json<{ bookings: { id: string; needsNewPass: boolean }[] }>().bookings).toEqual(
          [expect.objectContaining({ id: laterBookingId, needsNewPass: false })],
        );
      });
    });

    it('voids the pass on a full refund and never lowers the refunded amount', async () => {
      const paid = await payAndSettle();
      const refundEvent = {
        type: 'charge.refunded',
        paymentIntentId: paid.paymentIntentId,
        sheet: paid.sheet,
      };
      gateway.refund({ paymentIntentId: paid.paymentIntentId, refundedCents: PASS_PRICE_CENTS });
      await deliverWebhook(refundEvent);
      // Un aviso antiguo que llega tarde no puede deshacer la devolución.
      gateway.refund({ paymentIntentId: paid.paymentIntentId, refundedCents: 1000 });
      await deliverWebhook(refundEvent);

      expect(await readListedRefund(paid.paymentId)).toBe(PASS_PRICE_CENTS);
      expect(await readPassStatus(ana, paid.passId)).toBeUndefined();
    });
  });

  describe('fiscal data and receipts (prices include VAT)', () => {
    interface ReceiptBody {
      receiptNumber: string;
      baseCents: number;
      vatRatePercent: number;
      vatCents: number;
      totalCents: number;
      buyerName: string;
      seller: { legalName: string; taxId: string | null; taxAddress: string | null };
    }

    async function payAndSettle(client: Person): Promise<string> {
      const pass = await requestPass(client);
      const sheet = (await payPass(client, pass.id)).json<SheetBody>();
      const paymentIntentId = await readPaymentIntentId(sheet.paymentId);
      gateway.succeed(paymentIntentId);
      const settled = await world.call('POST', '/v1/webhooks/stripe', undefined, {
        headers: { 'stripe-signature': WEBHOOK_SIGNATURE },
        body: {
          type: 'payment_intent.succeeded',
          paymentIntentId,
          accountId: sheet.connectedAccountId,
        },
      });
      expect(settled.statusCode).toBe(204);
      return sheet.paymentId;
    }

    it('asks for the fiscal data before opening online payments', async () => {
      await setPlan('premium');

      const refused = await world.call(
        'POST',
        url('/payments/connect/onboarding-link'),
        ownerUserId,
        { centerId },
      );
      const status = await world.call('GET', url('/payments/status'), ownerUserId, { centerId });

      expect(refused.statusCode).toBe(422);
      expect(refused.json<{ code: string }>().code).toBe('FISCAL_DATA_REQUIRED');
      expect(status.json<{ isFiscalDataComplete: boolean }>().isFiscalDataComplete).toBe(false);
    });

    it('numbers receipts one after another and splits the VAT that the price includes', async () => {
      await makeCenterReadyToCharge();
      const firstPaymentId = await payAndSettle(ana);
      const secondPaymentId = await payAndSettle(luis);

      const first = await world.call(
        'GET',
        url(`/payments/${firstPaymentId}/receipt`),
        ana.userId,
        {
          centerId,
        },
      );
      const second = await world.call(
        'GET',
        url(`/payments/${secondPaymentId}/receipt`),
        ownerUserId,
        { centerId },
      );

      expect(first.statusCode).toBe(200);
      expect(first.json<ReceiptBody>()).toMatchObject({
        receiptNumber: expect.stringMatching(/^\d{4}-000001$/) as string,
        totalCents: PASS_PRICE_CENTS,
        baseCents: 4132,
        vatRatePercent: 21,
        vatCents: 868,
        buyerName: expect.any(String) as string,
        seller: { legalName: 'Academia Ninja SL', taxId: 'B12345678' },
      });
      expect(second.json<ReceiptBody>().receiptNumber).toMatch(/^\d{4}-000002$/);
    });

    it('shows a person only their own receipts, and none for an unpaid payment', async () => {
      await makeCenterReadyToCharge();
      const anaPaymentId = await payAndSettle(ana);
      const pendingPass = await requestPass(luis);
      const pendingSheet = (await payPass(luis, pendingPass.id)).json<SheetBody>();

      const others = await world.call(
        'GET',
        url(`/payments/${anaPaymentId}/receipt`),
        luis.userId,
        {
          centerId,
        },
      );
      const unpaid = await world.call(
        'GET',
        url(`/payments/${pendingSheet.paymentId}/receipt`),
        ownerUserId,
        { centerId },
      );
      const mine = await world.call('GET', url('/payments/mine'), ana.userId, { centerId });

      expect(others.statusCode).toBe(404);
      expect(unpaid.statusCode).toBe(404);
      expect(
        mine.json<{ payments: { id: string; receiptNumber: string | null }[] }>().payments,
      ).toEqual([
        expect.objectContaining({ id: anaPaymentId, receiptNumber: expect.any(String) as string }),
      ]);
    });
  });
});
