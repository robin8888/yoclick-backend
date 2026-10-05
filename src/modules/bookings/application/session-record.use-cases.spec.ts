import { DomainError } from '../../../shared/errors/domain-error';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type BookingView } from './ports/booking.repository';
import {
  type EndSessionOutcome,
  type SessionRecordRepository,
  type StartSessionOutcome,
} from './ports/session-record.repository';
import {
  EndSessionUseCase,
  ListSessionRecordsUseCase,
  StartSessionUseCase,
} from './session-record.use-cases';

const NOW = new Date('2026-10-05T10:00:00Z');
const STAFF: ActorContext = {
  userId: 'user-staff',
  centerId: 'center',
  membershipId: 'membership-staff',
  role: 'staff',
  permissions: [],
};

function buildBooking(overrides: Partial<BookingView> = {}): BookingView {
  return {
    id: 'booking-1',
    status: 'confirmed',
    startsAt: NOW,
    endsAt: new Date(NOW.getTime() + 3_600_000),
    service: { id: 'service-1', name: 'Sesión', durationMinutes: 60, color: null },
    staff: { membershipId: 'membership-staff', fullName: 'Ana' },
    cancelledAt: null,
    cancelWithinPolicy: null,
    startedAt: null,
    endedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function buildRepository(overrides: Partial<SessionRecordRepository>): SessionRecordRepository {
  return {
    startSession: jest.fn(),
    endSession: jest.fn(),
    listSessionRecords: jest.fn(),
    ...overrides,
  };
}

async function errorOf(work: Promise<unknown>): Promise<DomainError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Expected a DomainError');
}

describe('StartSessionUseCase', () => {
  const request = { actor: STAFF, bookingId: 'booking-1', now: NOW };

  it.each(['started', 'already_started'] as const)(
    'returns the booking when the repository says "%s"',
    async (kind) => {
      const booking = buildBooking({ startedAt: NOW });
      const outcome: StartSessionOutcome = { kind, booking };
      const repository = buildRepository({ startSession: jest.fn().mockResolvedValue(outcome) });

      await expect(new StartSessionUseCase(repository).execute(request)).resolves.toBe(booking);
    },
  );

  it.each([
    { kind: 'not_found', code: 'NOT_FOUND', status: 404 },
    { kind: 'not_startable', code: 'BOOKING_NOT_STARTABLE', status: 409 },
    { kind: 'session_already_open', code: 'SESSION_ALREADY_OPEN', status: 409 },
  ] as const)('maps "$kind" to $status $code', async ({ kind, code, status }) => {
    const outcome: StartSessionOutcome = { kind };
    const repository = buildRepository({ startSession: jest.fn().mockResolvedValue(outcome) });

    const error = await errorOf(new StartSessionUseCase(repository).execute(request));

    expect(error).toMatchObject({ code, httpStatus: status });
  });
});

describe('EndSessionUseCase', () => {
  const request = { actor: STAFF, bookingId: 'booking-1', notes: null, now: NOW };

  it.each(['ended', 'already_ended'] as const)(
    'returns the booking when the repository says "%s"',
    async (kind) => {
      const booking = buildBooking({ startedAt: NOW, endedAt: NOW, status: 'attended' });
      const outcome: EndSessionOutcome = { kind, booking };
      const repository = buildRepository({ endSession: jest.fn().mockResolvedValue(outcome) });

      await expect(new EndSessionUseCase(repository).execute(request)).resolves.toBe(booking);
    },
  );

  it.each([
    { kind: 'not_found', code: 'NOT_FOUND', status: 404 },
    { kind: 'not_started', code: 'SESSION_NOT_STARTED', status: 409 },
  ] as const)('maps "$kind" to $status $code', async ({ kind, code, status }) => {
    const outcome: EndSessionOutcome = { kind };
    const repository = buildRepository({ endSession: jest.fn().mockResolvedValue(outcome) });

    const error = await errorOf(new EndSessionUseCase(repository).execute(request));

    expect(error).toMatchObject({ code, httpStatus: status });
  });
});

describe('ListSessionRecordsUseCase', () => {
  const client = { membershipId: 'membership-client', fullName: 'Lucía' };

  it('derives planned and real durations, the open flag and the totals per professional', async () => {
    const closed = buildBooking({
      id: 'closed',
      status: 'attended',
      startedAt: new Date('2026-10-05T10:02:00Z'),
      endedAt: new Date('2026-10-05T10:50:30Z'),
    });
    const open = buildBooking({ id: 'open', startedAt: new Date('2026-10-05T11:00:00Z') });
    const unrecorded = buildBooking({ id: 'unrecorded' });
    const repository = buildRepository({
      listSessionRecords: jest.fn().mockResolvedValue({
        timeZone: 'Europe/Madrid',
        entries: [closed, open, unrecorded].map((booking) => ({ booking, client, notes: null })),
      }),
    });

    const report = await new ListSessionRecordsUseCase(repository).execute({
      actor: STAFF,
      query: { fromDate: '2026-10-05', toDate: '2026-10-05', staffMembershipId: null, now: NOW },
    });

    expect(
      report.records.map(({ booking, ...rest }) => ({
        id: booking.id,
        ...rest,
        client: undefined,
      })),
    ).toEqual([
      {
        id: 'closed',
        plannedDurationSeconds: 3600,
        actualDurationSeconds: 2910,
        isOpen: false,
        notes: null,
        client: undefined,
      },
      {
        id: 'open',
        plannedDurationSeconds: 3600,
        actualDurationSeconds: null,
        isOpen: true,
        notes: null,
        client: undefined,
      },
      {
        id: 'unrecorded',
        plannedDurationSeconds: 3600,
        actualDurationSeconds: null,
        isOpen: false,
        notes: null,
        client: undefined,
      },
    ]);
    expect(report.totals).toEqual([
      {
        staffMembershipId: 'membership-staff',
        staffName: 'Ana',
        classCount: 1,
        plannedSeconds: 3600,
        actualSeconds: 2910,
        openCount: 1,
      },
    ]);
  });
});
