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

  async function setClientLimit(maxClients: number | null): Promise<void> {
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.center.update({ where: { id: centerId }, data: { maxClients } });
    });
  }

  async function readStatus(userId: string): Promise<string> {
    const response = await world.call('GET', url('/payments/status'), userId, { centerId });
    return response.json<{ status: string }>().status;
  }

  /** Deja el centro cobrando: Premium y con el alta de Stripe terminada. */
  async function makeCenterReadyToCharge(): Promise<void> {
    await setClientLimit(null);
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
    await setClientLimit(150);

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
    await setClientLimit(null);
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
    await setClientLimit(null);
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
    await setClientLimit(null);
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
  describe('room rentals', () => {
    const MILLISECONDS_PER_DAY = 86_400_000;
    let roomId: string;

    interface RentalBody {
      id: string;
      priceCents: number | null;
      isPaid: boolean;
    }

    const createRental = async (body: object) =>
      world.call('POST', url(`/rooms/${roomId}/blocks`), ownerUserId, {
        centerId,
        body: {
          startsAt: new Date(Date.now() + 5 * MILLISECONDS_PER_DAY).toISOString(),
          endsAt: new Date(Date.now() + 5 * MILLISECONDS_PER_DAY + 3_600_000).toISOString(),
          reason: 'rental',
          ...body,
        },
      });

    async function readNotificationKinds(userId: string): Promise<string[]> {
      const response = await world.call('GET', url('/notifications'), userId, { centerId });
      return response
        .json<{ notifications: { kind: string }[] }>()
        .notifications.map(({ kind }) => kind);
    }

    beforeEach(async () => {
      const room = await world.call('POST', url('/rooms'), ownerUserId, {
        centerId,
        body: { name: 'Sala grande', capacity: 10 },
      });
      roomId = room.json<{ id: string }>().id;
    });

    it('rejects a price without a renter, a renter that is not a client and a renter on other reasons', async () => {
      const staff = await world.addMember(centerId, 'staff', 'staff');

      expect((await createRental({ priceCents: 3000 })).statusCode).toBe(400);
      expect(
        (await createRental({ renterMembershipId: staff.membershipId, priceCents: 3000 }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await createRental({
            reason: 'maintenance',
            renterMembershipId: ana.membershipId,
            priceCents: 3000,
          })
        ).statusCode,
      ).toBe(400);
    });

    it('lets the renter pay online and marks the rental as paid', async () => {
      await makeCenterReadyToCharge();
      const created = await createRental({
        renterMembershipId: ana.membershipId,
        priceCents: 4500,
      });
      expect(created.statusCode).toBe(201);
      const block = created.json<{
        block: { id: string; isPaid: boolean; priceCents: number; renter: { fullName: string } };
      }>().block;
      expect(block).toMatchObject({ isPaid: false, priceCents: 4500 });
      expect(await readNotificationKinds(ana.userId)).toContain('room_rental_assigned');

      const mineBefore = await world.call('GET', url('/room-rentals/mine'), ana.userId, {
        centerId,
      });
      expect(mineBefore.json<{ rentals: RentalBody[] }>().rentals).toEqual([
        expect.objectContaining({ id: block.id, priceCents: 4500, isPaid: false }),
      ]);
      const other = await world.call('GET', url('/room-rentals/mine'), luis.userId, { centerId });
      expect(other.json<{ rentals: RentalBody[] }>().rentals).toEqual([]);

      const stranger = await world.call('POST', url(`/room-rentals/${block.id}/pay`), luis.userId, {
        centerId,
      });
      expect(stranger.statusCode).toBe(404);

      const sheetResponse = await world.call(
        'POST',
        url(`/room-rentals/${block.id}/pay`),
        ana.userId,
        { centerId },
      );
      expect(sheetResponse.statusCode).toBe(201);
      const sheet = sheetResponse.json<SheetBody>();
      expect(sheet.amountCents).toBe(4500);

      gateway.succeed(await readPaymentIntentId(sheet.paymentId));
      const confirmed = await world.call(
        'POST',
        url(`/payments/${sheet.paymentId}/confirm`),
        ana.userId,
        { centerId },
      );
      expect(confirmed.json<{ status: string }>().status).toBe('succeeded');

      const payments = await world.call('GET', url('/payments'), ownerUserId, { centerId });
      expect(payments.statusCode).toBe(200);
      expect(payments.json<{ payments: object[] }>().payments).toEqual([
        expect.objectContaining({
          kind: 'room_rental',
          label: 'Sala grande',
          amountCents: 4500,
          status: 'succeeded',
        }),
      ]);
      const clientCannotList = await world.call('GET', url('/payments'), ana.userId, {
        centerId,
      });
      expect(clientCannotList.statusCode).toBe(403);

      const ownerNotices = await readNotificationKinds(ownerUserId);
      expect(ownerNotices).toContain('payment_received');

      const mineAfter = await world.call('GET', url('/room-rentals/mine'), ana.userId, {
        centerId,
      });
      expect(mineAfter.json<{ rentals: RentalBody[] }>().rentals[0]?.isPaid).toBe(true);
      const again = await world.call('POST', url(`/room-rentals/${block.id}/pay`), ana.userId, {
        centerId,
      });
      expect(again.statusCode).toBe(404);
    });
  });
});
