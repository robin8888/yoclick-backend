import { FakeBillingGateway } from '../../billing/infrastructure/fake-billing-gateway';
import {
  type ReportableVoiceOverage,
  type VoiceOverageRepository,
} from './ports/voice-overage.repository';
import { ReportVoiceOverageUseCase } from './report-voice-overage.use-case';

const NOW = new Date('2026-10-28T12:00:00.000Z');

function buildCall(callLogId: string, minutes: number): ReportableVoiceOverage {
  return {
    callLogId,
    centerId: '0198f4a0-0000-7000-8000-000000000001',
    stripeCustomerId: 'cus_1',
    minutes,
    endedAt: new Date('2026-10-28T11:00:00.000Z'),
  };
}

class InMemoryOverages implements VoiceOverageRepository {
  pending = new Map<string, ReportableVoiceOverage>();
  reportedAt = new Map<string, Date>();

  findReportableCall(callLogId: string): Promise<ReportableVoiceOverage | null> {
    return Promise.resolve(this.pending.get(callLogId) ?? null);
  }

  listReportableCalls(): Promise<ReportableVoiceOverage[]> {
    return Promise.resolve([...this.pending.values()]);
  }

  markReported(callLogId: string, reportedAt: Date): Promise<boolean> {
    const wasPending = this.pending.delete(callLogId);
    if (wasPending) this.reportedAt.set(callLogId, reportedAt);
    return Promise.resolve(wasPending);
  }
}

describe('ReportVoiceOverageUseCase', () => {
  let overages: InMemoryOverages;
  let gateway: FakeBillingGateway;
  let useCase: ReportVoiceOverageUseCase;

  beforeEach(() => {
    overages = new InMemoryOverages();
    gateway = new FakeBillingGateway();
    useCase = new ReportVoiceOverageUseCase(overages, gateway);
  });

  it('reports the excess minutes of a call to the meter with the identifier of that call and marks it', async () => {
    overages.pending.set('call-1', buildCall('call-1', 7));

    await useCase.reportCall('call-1', NOW);

    expect(gateway.reportedVoiceOverages).toEqual([
      {
        customerId: 'cus_1',
        minutes: 7,
        identifier: 'yoclick-voice-overage-call-1',
        occurredAt: new Date('2026-10-28T11:00:00.000Z'),
      },
    ]);
    expect(overages.reportedAt.get('call-1')).toEqual(NOW);
  });

  it('reports nothing for a call with no pending excess', async () => {
    await useCase.reportCall('call-without-excess', NOW);

    expect(gateway.reportedVoiceOverages).toEqual([]);
  });

  it('never reports the same call twice, however many times it is asked', async () => {
    overages.pending.set('call-1', buildCall('call-1', 7));

    await useCase.reportCall('call-1', NOW);
    await useCase.reportCall('call-1', NOW);
    await useCase.reportPending(NOW);

    expect(gateway.reportedVoiceOverages).toHaveLength(1);
  });

  it('keeps the call pending when Stripe fails, without failing the end of the call, and the sweep retries it', async () => {
    overages.pending.set('call-1', buildCall('call-1', 7));
    gateway.isVoiceOverageReportFailing = true;

    await expect(useCase.reportCall('call-1', NOW)).resolves.toBeUndefined();
    expect(overages.pending.has('call-1')).toBe(true);

    gateway.isVoiceOverageReportFailing = false;
    const summary = await useCase.reportPending(NOW);

    expect(summary).toEqual({ reportedCalls: 1, failedCalls: 0 });
    expect(gateway.reportedVoiceOverages.map((reported) => reported.identifier)).toEqual([
      'yoclick-voice-overage-call-1',
    ]);
    expect(overages.pending.size).toBe(0);
  });

  it('retries with the same identifier when the report reached Stripe but marking it failed, so Stripe drops the repeat', async () => {
    overages.pending.set('call-1', buildCall('call-1', 7));
    jest.spyOn(overages, 'markReported').mockRejectedValueOnce(new Error('db down'));

    await useCase.reportCall('call-1', NOW);
    await useCase.reportPending(NOW);

    expect(gateway.reportedVoiceOverages).toHaveLength(1);
    expect(overages.pending.size).toBe(0);
  });

  it('reports every pending call in the sweep and counts the ones that fail', async () => {
    overages.pending.set('call-1', buildCall('call-1', 3));
    overages.pending.set('call-2', buildCall('call-2', 4));
    const original = gateway.reportVoiceOverage.bind(gateway);
    gateway.reportVoiceOverage = (input) =>
      input.identifier.endsWith('call-2')
        ? Promise.reject(new Error('Stripe is down'))
        : original(input);

    const summary = await useCase.reportPending(NOW);

    expect(summary).toEqual({ reportedCalls: 1, failedCalls: 1 });
    expect([...overages.pending.keys()]).toEqual(['call-2']);
  });
});
