import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../../shared/config/environment.schema';
import { type EmailMessage, type EmailSender } from '../../../shared/email/email-sender';
import { type PlanPaymentEmailKind } from '../domain/plan-payment-reminders';
import { FakeBillingGateway } from '../infrastructure/fake-billing-gateway';
import { PlanPaymentLinkService } from './plan-payment-link.service';
import { OpenPlanPaymentLinkUseCase, SendPlanPaymentEmailsUseCase } from './plan-payment.use-cases';
import {
  type BillingCenter,
  type BillingRepository,
  type BillingTransaction,
  type CheckoutFacts,
  type PlanOffer,
  type TrialReminderCandidate,
} from './ports/billing.repository';

const NOW = new Date('2026-10-27T10:00:00.000Z');
const HOUR_MS = 3_600_000;
const CENTER_ID = '0198a8a0-0000-7000-8000-000000000001';
const OTHER_CENTER_ID = '0198a8a0-0000-7000-8000-000000000002';

function buildCenter(overrides: Partial<BillingCenter> = {}): BillingCenter {
  return {
    id: CENTER_ID,
    name: 'Gymtonic',
    status: 'trial',
    planId: 'pro',
    trialEndsAt: new Date(NOW.getTime() + 48 * HOUR_MS),
    graceEndsAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

function buildOffer(id: string, name: string): PlanOffer {
  return {
    id,
    name,
    monthlyPriceCents: 3900,
    annualMonthlyPriceCents: 3250,
    setupFeeCents: 0,
    maxClients: null,
    documentStorageLimitBytes: 1,
    videoStorageLimitBytes: null,
    features: [],
    isAvailable: true,
  };
}

function buildCandidate(overrides: Partial<TrialReminderCandidate> = {}): TrialReminderCandidate {
  return {
    center: buildCenter(),
    owners: [{ email: 'owner@example.com', fullName: 'Ana' }],
    sentKinds: [],
    ...overrides,
  };
}

function notUsed(): never {
  throw new Error('Not used by these tests');
}

/** Un repositorio en memoria: apunta los envíos y deshace los apuntes si la transacción falla. */
class InMemoryBillingRepository implements BillingRepository {
  claimedEmails = new Set<string>();
  savedCustomerIds: string[] = [];
  candidates: TrialReminderCandidate[] = [];
  offers: PlanOffer[] = [buildOffer('basic', 'Básico'), buildOffer('pro', 'Pro')];
  checkoutFacts: CheckoutFacts | null = null;

  async runInTransaction<TResult>(
    work: (transaction: BillingTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = new Set(this.claimedEmails);
    try {
      return await work(this.buildTransaction());
    } catch (error: unknown) {
      this.claimedEmails = snapshot;
      throw error;
    }
  }

  private buildTransaction(): BillingTransaction {
    return {
      markEventAsNew: notUsed,
      findCenterById: notUsed,
      findCenterByCustomerId: notUsed,
      updateCenter: notUsed,
      recordStripeCharge: notUsed,
      readClientLoad: notUsed,
      writeAudit: notUsed,
      notifyOwners: notUsed,
      listCentersToSweep: notUsed,
      listCentersSolelyOwnedBy: notUsed,
      findCenterForClosure: notUsed,
      listActiveMembers: notUsed,
      markCenterClosed: notUsed,
      notifyCenterClosed: notUsed,
      endAllMemberships: notUsed,
      listTrialReminderCandidates: () => Promise.resolve(this.candidates),
      listAvailablePlanOffers: () => Promise.resolve(this.offers),
      claimPlanPaymentEmail: (centerId: string, kind: PlanPaymentEmailKind) => {
        const key = `${centerId}:${kind}`;
        const isNew = !this.claimedEmails.has(key);
        this.claimedEmails.add(key);
        return Promise.resolve(isNew);
      },
      findCheckoutFactsForCenter: () => Promise.resolve(this.checkoutFacts),
      saveCustomerIdForCenter: (_centerId: string, customerId: string) => {
        this.savedCustomerIds.push(customerId);
        return Promise.resolve();
      },
    };
  }

  listPlanOffers = notUsed;
  listPlanSpecs = notUsed;
  savePlanStripeIds = notUsed;
  findCheckoutFacts = notUsed;
  saveCustomerId = notUsed;
  findCustomerId = notUsed;
}

class RecordingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failNextSends = 0;

  send(message: EmailMessage): Promise<void> {
    if (this.failNextSends > 0) {
      this.failNextSends -= 1;
      return Promise.reject(new Error('Delivery failed'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

function buildLinks(): PlanPaymentLinkService {
  return new PlanPaymentLinkService(
    new ConfigService<Environment, true>({
      AUTH_CODE_PEPPER_BASE64: Buffer.alloc(32, 7).toString('base64'),
      PUBLIC_API_URL: 'https://api.yoclick.app',
    }),
  );
}

describe('SendPlanPaymentEmailsUseCase', () => {
  let repository: InMemoryBillingRepository;
  let emailSender: RecordingEmailSender;
  let useCase: SendPlanPaymentEmailsUseCase;

  beforeEach(() => {
    repository = new InMemoryBillingRepository();
    emailSender = new RecordingEmailSender();
    useCase = new SendPlanPaymentEmailsUseCase(repository, emailSender, buildLinks());
  });

  it('emails every owner of a center whose trial is about to end, with a link per plan and period', async () => {
    repository.candidates = [
      buildCandidate({
        owners: [
          { email: 'ana@example.com', fullName: 'Ana' },
          { email: 'luis@example.com', fullName: 'Luis' },
        ],
      }),
    ];

    const summary = await useCase.execute(NOW);

    expect(summary).toEqual({ emailsSent: 2, centersFailed: 0 });
    expect(emailSender.sent.map((message) => message.to)).toEqual([
      'ana@example.com',
      'luis@example.com',
    ]);
    const links = emailSender.sent[0]?.textBody.match(/https:\/\/api\.yoclick\.app\/\S+/g) ?? [];
    expect(links).toHaveLength(4);
    expect(emailSender.sent[0]?.subject).toBe('Tu prueba de Yoclick acaba en 3 días');
  });

  it('does not send the same reminder twice', async () => {
    repository.candidates = [buildCandidate()];

    await useCase.execute(NOW);
    const secondRun = await useCase.execute(NOW);

    expect(secondRun.emailsSent).toBe(0);
    expect(emailSender.sent).toHaveLength(1);
  });

  it('skips a reminder that was already sent according to the candidate', async () => {
    repository.candidates = [buildCandidate({ sentKinds: ['trial_ending_3'] })];

    const summary = await useCase.execute(NOW);

    expect(summary.emailsSent).toBe(0);
    expect(repository.claimedEmails.size).toBe(0);
  });

  it.each([{ name: 'the trial ended long ago', hours: -10 * 24 }])(
    'sends nothing when $name',
    async ({ hours }) => {
      repository.candidates = [
        buildCandidate({
          center: buildCenter({ trialEndsAt: new Date(NOW.getTime() + hours * HOUR_MS) }),
        }),
      ];

      await expect(useCase.execute(NOW)).resolves.toEqual({ emailsSent: 0, centersFailed: 0 });
    },
  );

  it('sends the welcome email while the trial has more than a week left, and only once', async () => {
    const trialEndsAt = new Date(NOW.getTime() + 10 * 24 * HOUR_MS);
    repository.candidates = [buildCandidate({ center: buildCenter({ trialEndsAt }) })];

    await expect(useCase.execute(NOW)).resolves.toEqual({ emailsSent: 1, centersFailed: 0 });
    expect(repository.claimedEmails.has(`${CENTER_ID}:trial_started`)).toBe(true);

    repository.candidates = [
      buildCandidate({ center: buildCenter({ trialEndsAt }), sentKinds: ['trial_started'] }),
    ];
    await expect(useCase.execute(NOW)).resolves.toEqual({ emailsSent: 0, centersFailed: 0 });
  });

  it('sends nothing when no plan can be bought yet', async () => {
    repository.candidates = [buildCandidate()];
    repository.offers = [];

    await expect(useCase.execute(NOW)).resolves.toEqual({ emailsSent: 0, centersFailed: 0 });
  });

  it('undoes the record when the email fails so the next run retries, and keeps going with other centers', async () => {
    repository.candidates = [
      buildCandidate(),
      buildCandidate({ center: buildCenter({ id: OTHER_CENTER_ID, name: 'Nails' }) }),
    ];
    emailSender.failNextSends = 1;

    const firstRun = await useCase.execute(NOW);

    expect(firstRun).toEqual({ emailsSent: 1, centersFailed: 1 });
    expect(repository.claimedEmails.has(`${CENTER_ID}:trial_ending_3`)).toBe(false);

    const secondRun = await useCase.execute(NOW);

    expect(secondRun).toEqual({ emailsSent: 1, centersFailed: 0 });
    expect(emailSender.sent.map((message) => message.textBody).join('\n')).toContain('Gymtonic');
  });
});

describe('OpenPlanPaymentLinkUseCase', () => {
  let repository: InMemoryBillingRepository;
  let gateway: FakeBillingGateway;
  let links: PlanPaymentLinkService;
  let useCase: OpenPlanPaymentLinkUseCase;

  beforeEach(() => {
    repository = new InMemoryBillingRepository();
    repository.checkoutFacts = {
      center: buildCenter(),
      ownerEmail: 'owner@example.com',
      planPrices: {
        monthlyPriceId: 'price_m',
        annualPriceId: 'price_a',
        setupFeePriceId: null,
        taxRateId: 'txr_1',
      },
    };
    gateway = new FakeBillingGateway();
    links = buildLinks();
    useCase = new OpenPlanPaymentLinkUseCase(repository, gateway, links);
  });

  async function buildToken(period: 'monthly' | 'annual'): Promise<string> {
    const url = await links.buildUrl({ centerId: CENTER_ID, planId: 'pro', period });
    return new URL(url).searchParams.get('token') ?? '';
  }

  it('opens a fresh Stripe checkout for the center, plan and period in the link', async () => {
    const result = await useCase.execute(await buildToken('annual'));

    expect(result.url).toContain(CENTER_ID);
    expect(gateway.checkoutRequests).toHaveLength(1);
    expect(gateway.checkoutRequests[0]).toMatchObject({
      centerId: CENTER_ID,
      planId: 'pro',
      period: 'annual',
      priceId: 'price_a',
    });
  });

  it('creates and saves the Stripe customer when the center has none', async () => {
    await useCase.execute(await buildToken('monthly'));

    expect(repository.savedCustomerIds).toEqual([`cus_fake_${CENTER_ID}`]);
  });

  it('refuses a center that already pays with an active subscription', async () => {
    repository.checkoutFacts = {
      ...(repository.checkoutFacts as CheckoutFacts),
      center: buildCenter({ status: 'active', stripeSubscriptionId: 'sub_1' }),
    };

    await expect(useCase.execute(await buildToken('monthly'))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(gateway.checkoutRequests).toHaveLength(0);
  });

  it('refuses a tampered link before reading anything', async () => {
    await expect(useCase.execute('not-a-token')).rejects.toMatchObject({
      code: 'PAYMENT_LINK_INVALID',
    });
  });
});
