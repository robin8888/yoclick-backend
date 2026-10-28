import { type PushDispatcher } from '../../push/application/push-dispatcher';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { FakeBillingGateway } from '../infrastructure/fake-billing-gateway';
import { CloseCenterUseCase } from './close-center.use-case';
import {
  type BillingRepository,
  type BillingTransaction,
  type CenterClosedNotificationInput,
  type CenterClosureFacts,
  type CenterMemberRef,
  type OwnedCenterRef,
} from './ports/billing.repository';

const CENTER_ID = '0198a8a0-0000-7000-8000-000000000001';
const OWNER_USER_ID = 'owner-user';
const CLIENT_USER_ID = 'client-user';
const STAFF_USER_ID = 'staff-user';
const SUBSCRIPTION_ID = 'sub_123';

function notUsed(): never {
  throw new Error('Not used by these tests');
}

/** Un repositorio en memoria que apunta lo que el cierre escribe y deshace todo si la transacción falla. */
class InMemoryBillingRepository implements BillingRepository {
  center: CenterClosureFacts | null = {
    name: 'Studio Norte',
    stripeSubscriptionId: SUBSCRIPTION_ID,
    closedAt: null,
  };
  members: CenterMemberRef[] = [
    { membershipId: 'm-owner', userId: OWNER_USER_ID, role: 'owner' },
    { membershipId: 'm-client', userId: CLIENT_USER_ID, role: 'client' },
    { membershipId: 'm-staff', userId: STAFF_USER_ID, role: 'staff' },
  ];
  ownedCenters: OwnedCenterRef[] = [{ centerId: CENTER_ID, name: 'Studio Norte' }];
  closedAt: Date | null = null;
  notifications: CenterClosedNotificationInput[] = [];
  endedMembershipsOf: string[] = [];
  audit: { action: string; details: Readonly<Record<string, unknown>> }[] = [];
  failOnAudit = false;

  async runInTransaction<TResult>(
    work: (transaction: BillingTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = {
      closedAt: this.closedAt,
      notifications: [...this.notifications],
      endedMembershipsOf: [...this.endedMembershipsOf],
      audit: [...this.audit],
    };
    try {
      return await work(this.buildTransaction());
    } catch (error: unknown) {
      Object.assign(this, snapshot);
      throw error;
    }
  }

  private buildTransaction(): BillingTransaction {
    return {
      markEventAsNew: notUsed,
      listOwnerContacts: notUsed,
      findVoiceSubscription: notUsed,
      updateVoiceSubscription: notUsed,
      findVoiceAddonTier: notUsed,
      saveChosenVoiceSubscription: notUsed,
      findPlanTaxRateId: notUsed,
      isVoiceAddonOffered: notUsed,
      findCenterById: notUsed,
      findCenterByCustomerId: notUsed,
      updateCenter: notUsed,
      recordStripeCharge: notUsed,
      readClientLoad: notUsed,
      notifyOwners: notUsed,
      listCentersToSweep: notUsed,
      listTrialReminderCandidates: notUsed,
      listAvailablePlanOffers: notUsed,
      claimPlanPaymentEmail: notUsed,
      findCheckoutFactsForCenter: notUsed,
      saveCustomerIdForCenter: notUsed,
      writeAudit: (entry) => {
        if (this.failOnAudit) return Promise.reject(new Error('audit failed'));
        this.audit.push({ action: entry.action, details: entry.details });
        return Promise.resolve();
      },
      listCentersSolelyOwnedBy: () => Promise.resolve(this.ownedCenters),
      findCenterForClosure: () => Promise.resolve(this.center),
      listActiveMembers: () => Promise.resolve(this.members),
      markCenterClosed: (_centerId: string, closedAt: Date) => {
        this.closedAt = closedAt;
        return Promise.resolve();
      },
      notifyCenterClosed: (input) => {
        this.notifications.push(input);
        return Promise.resolve();
      },
      endAllMemberships: (centerId: string) => {
        this.endedMembershipsOf.push(centerId);
        return Promise.resolve();
      },
    };
  }

  listPlanOffers = notUsed;
  listPlanSpecs = notUsed;
  savePlanStripeIds = notUsed;
  listVoiceAddonSpecs = notUsed;
  saveVoiceAddonStripeIds = notUsed;
  findCheckoutFacts = notUsed;
  saveCustomerId = notUsed;
  findCustomerId = notUsed;
}

class RecordingPushDispatcher {
  readonly flushedFor: ActorContext[] = [];

  flushCenter(actor: ActorContext): Promise<void> {
    this.flushedFor.push(actor);
    return Promise.resolve();
  }
}

describe('CloseCenterUseCase', () => {
  let repository: InMemoryBillingRepository;
  let gateway: FakeBillingGateway;
  let push: RecordingPushDispatcher;
  let useCase: CloseCenterUseCase;

  beforeEach(() => {
    repository = new InMemoryBillingRepository();
    gateway = new FakeBillingGateway();
    push = new RecordingPushDispatcher();
    useCase = new CloseCenterUseCase(repository, gateway, push as unknown as PushDispatcher);
  });

  it('closes the center: cancels the subscription, marks it closed, takes everybody out and audits it', async () => {
    await useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID });

    expect(gateway.cancelledSubscriptionIds).toEqual([SUBSCRIPTION_ID]);
    expect(repository.closedAt).toBeInstanceOf(Date);
    expect(repository.endedMembershipsOf).toEqual([CENTER_ID]);
    expect(repository.audit).toEqual([
      { action: 'center_closed', details: { hadSubscription: true } },
    ]);
  });

  it('tells every member except whoever closes it, with only the center name as data', async () => {
    await useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID });

    expect(repository.notifications).toEqual([
      {
        centerId: CENTER_ID,
        recipientMembershipIds: ['m-client', 'm-staff'],
        data: { centerName: 'Studio Norte' },
      },
    ]);
  });

  it('sends the push after the closure is saved, for the people who were told', async () => {
    await useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID });

    expect(push.flushedFor).toHaveLength(1);
    expect(push.flushedFor[0]).toMatchObject({ centerId: CENTER_ID, userId: CLIENT_USER_ID });
  });

  it('closes a center that never had a subscription without calling Stripe', async () => {
    repository.center = { name: 'Studio Norte', stripeSubscriptionId: null, closedAt: null };

    await useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID });

    expect(gateway.cancelledSubscriptionIds).toEqual([]);
    expect(repository.closedAt).toBeInstanceOf(Date);
    expect(repository.audit[0]?.details).toEqual({ hadSubscription: false });
  });

  it('sends no push when nobody else was in the center', async () => {
    repository.members = [{ membershipId: 'm-owner', userId: OWNER_USER_ID, role: 'owner' }];

    await useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID });

    expect(repository.notifications[0]?.recipientMembershipIds).toEqual([]);
    expect(push.flushedFor).toEqual([]);
  });

  it.each([
    { name: 'it does not exist', center: null },
    {
      name: 'it is already closed',
      center: {
        name: 'Studio Norte',
        stripeSubscriptionId: SUBSCRIPTION_ID,
        closedAt: new Date('2026-10-01T10:00:00Z'),
      },
    },
  ])('does nothing when $name', async ({ center }) => {
    repository.center = center;

    await useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID });

    expect(gateway.cancelledSubscriptionIds).toEqual([]);
    expect(repository.notifications).toEqual([]);
    expect(push.flushedFor).toEqual([]);
  });

  it('keeps the center open when Stripe cannot cancel, so the owner can try again', async () => {
    gateway.cancelSubscription = () => Promise.reject(new Error('stripe is down'));

    await expect(
      useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID }),
    ).rejects.toThrow('stripe is down');

    expect(repository.closedAt).toBeNull();
    expect(repository.notifications).toEqual([]);
  });

  it('undoes the whole closure when something fails halfway, and warns nobody', async () => {
    repository.failOnAudit = true;

    await expect(
      useCase.execute({ centerId: CENTER_ID, closedByUserId: OWNER_USER_ID }),
    ).rejects.toThrow('audit failed');

    expect(repository.closedAt).toBeNull();
    expect(repository.notifications).toEqual([]);
    expect(repository.endedMembershipsOf).toEqual([]);
    expect(push.flushedFor).toEqual([]);
  });

  it('lists the centers a person solely owns', async () => {
    await expect(useCase.listCentersSolelyOwnedBy(OWNER_USER_ID)).resolves.toEqual([
      { centerId: CENTER_ID, name: 'Studio Norte' },
    ]);
  });
});
