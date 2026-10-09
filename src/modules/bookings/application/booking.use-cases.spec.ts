import { DomainError } from '../../../shared/errors/domain-error';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  CancelBookingUseCase,
  CreateBookingUseCase,
  GetDayAgendaUseCase,
  RescheduleBookingByTeamUseCase,
  RescheduleBookingUseCase,
} from './booking.use-cases';
import {
  type BookingRepository,
  type BookingView,
  type CancellationFacts,
  type CreateBookingOutcome,
  type RescheduleOutcome,
} from './ports/booking.repository';

const NOW = new Date('2026-10-05T10:00:00Z');
const HOUR_MS = 3_600_000;
const CLIENT: ActorContext = {
  userId: 'user-client',
  centerId: 'center',
  membershipId: 'membership-client',
  role: 'client',
  permissions: [],
};

function buildBooking(overrides: Partial<BookingView> = {}): BookingView {
  return {
    id: 'booking-1',
    status: 'confirmed',
    startsAt: new Date(NOW.getTime() + 48 * HOUR_MS),
    endsAt: new Date(NOW.getTime() + 49 * HOUR_MS),
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

function buildRepository(overrides: Partial<BookingRepository> = {}): BookingRepository {
  return {
    createBooking: jest.fn(),
    rescheduleBooking: jest.fn(),
    rescheduleByTeam: jest.fn(),
    listClientBookings: jest.fn(),
    findCancellationFacts: jest.fn(),
    markCancelled: jest.fn(),
    cancelByTeam: jest.fn(),
    listDayAgenda: jest.fn(),
    ...overrides,
  };
}

function facts(
  booking: BookingView,
  overrides: Partial<CancellationFacts> = {},
): CancellationFacts {
  return {
    booking,
    serviceCancelNoticeMinutes: null,
    centerFreeCancellationHours: null,
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

describe('CreateBookingUseCase', () => {
  const command = {
    serviceId: 'service-1',
    startsAt: NOW,
    preferredStaffMembershipId: null,
    idempotencyKey: 'key',
    now: NOW,
  };

  it('returns the booking that was created', async () => {
    const booking = buildBooking();
    const repository = buildRepository({
      createBooking: jest.fn().mockResolvedValue({ kind: 'created', booking }),
    });

    await expect(new CreateBookingUseCase(repository).execute(CLIENT, command)).resolves.toBe(
      booking,
    );
  });

  it.each([
    { kind: 'service_not_found', code: 'NOT_FOUND', status: 404 },
    { kind: 'outside_window', code: 'OUTSIDE_BOOKING_WINDOW', status: 409 },
    { kind: 'slot_unavailable', code: 'SLOT_UNAVAILABLE', status: 409 },
    { kind: 'already_booked', code: 'ALREADY_BOOKED', status: 409 },
  ] as const)('maps "$kind" to $status $code', async ({ kind, code, status }) => {
    const outcome: CreateBookingOutcome = { kind };
    const repository = buildRepository({ createBooking: jest.fn().mockResolvedValue(outcome) });

    const error = await errorOf(new CreateBookingUseCase(repository).execute(CLIENT, command));

    expect(error).toMatchObject({ code, httpStatus: status });
  });
});

describe('RescheduleBookingUseCase', () => {
  const command = {
    bookingId: 'booking-1',
    startsAt: new Date(NOW.getTime() + 72 * HOUR_MS),
    now: NOW,
  };

  it('returns the moved booking', async () => {
    const booking = buildBooking({ startsAt: command.startsAt });
    const repository = buildRepository({
      rescheduleBooking: jest
        .fn()
        .mockResolvedValue({ kind: 'rescheduled', booking, hasChangedTime: true }),
    });

    const outcome = await new RescheduleBookingUseCase(repository).execute(CLIENT, command);

    expect(outcome.booking).toBe(booking);
  });

  it.each([
    { kind: 'not_found', code: 'NOT_FOUND', status: 404 },
    { kind: 'not_reschedulable', code: 'BOOKING_NOT_RESCHEDULABLE', status: 409 },
    { kind: 'too_late', code: 'RESCHEDULE_TOO_LATE', status: 409 },
    { kind: 'outside_window', code: 'OUTSIDE_BOOKING_WINDOW', status: 409 },
    { kind: 'slot_unavailable', code: 'SLOT_UNAVAILABLE', status: 409 },
    { kind: 'already_booked', code: 'ALREADY_BOOKED', status: 409 },
    { kind: 'service_not_found', code: 'NOT_FOUND', status: 404 },
  ] as const)('maps "$kind" to $status $code', async ({ kind, code, status }) => {
    const outcome: RescheduleOutcome = { kind };
    const repository = buildRepository({ rescheduleBooking: jest.fn().mockResolvedValue(outcome) });

    const error = await errorOf(new RescheduleBookingUseCase(repository).execute(CLIENT, command));

    expect(error).toMatchObject({ code, httpStatus: status });
  });
});

describe('CancelBookingUseCase', () => {
  const request = { actor: CLIENT, bookingId: 'booking-1', now: NOW };

  it('cancels within the policy using the 24 hours default when nobody defines one', async () => {
    const booking = buildBooking();
    const markCancelled = jest
      .fn()
      .mockResolvedValue(buildBooking({ status: 'cancelled', cancelWithinPolicy: true }));
    const repository = buildRepository({
      findCancellationFacts: jest.fn().mockResolvedValue(facts(booking)),
      markCancelled,
    });

    const result = await new CancelBookingUseCase(repository).execute(request);

    expect(markCancelled).toHaveBeenCalledWith(CLIENT, {
      bookingId: 'booking-1',
      cancelledAt: NOW,
      isWithinPolicy: true,
    });
    expect(result.withinPolicy).toBe(true);
  });

  it('flags a late cancellation using the notice of the service over the center policy', async () => {
    const booking = buildBooking({ startsAt: new Date(NOW.getTime() + 3 * HOUR_MS) });
    const markCancelled = jest
      .fn()
      .mockResolvedValue(buildBooking({ status: 'cancelled', cancelWithinPolicy: false }));
    const repository = buildRepository({
      findCancellationFacts: jest
        .fn()
        .mockResolvedValue(
          facts(booking, { serviceCancelNoticeMinutes: 240, centerFreeCancellationHours: 1 }),
        ),
      markCancelled,
    });

    const result = await new CancelBookingUseCase(repository).execute(request);

    expect(markCancelled).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ isWithinPolicy: false }),
    );
    expect(result.withinPolicy).toBe(false);
  });

  it('answers the same result for a booking that was already cancelled, without touching it', async () => {
    const cancelled = buildBooking({ status: 'cancelled', cancelWithinPolicy: false });
    const markCancelled = jest.fn();
    const repository = buildRepository({
      findCancellationFacts: jest.fn().mockResolvedValue(facts(cancelled)),
      markCancelled,
    });

    const result = await new CancelBookingUseCase(repository).execute(request);

    expect(result).toEqual({ booking: cancelled, withinPolicy: false });
    expect(markCancelled).not.toHaveBeenCalled();
  });

  it('refuses a booking that already started', async () => {
    const started = buildBooking({ startsAt: new Date(NOW.getTime() - HOUR_MS) });
    const repository = buildRepository({
      findCancellationFacts: jest.fn().mockResolvedValue(facts(started)),
    });

    const error = await errorOf(new CancelBookingUseCase(repository).execute(request));

    expect(error).toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE', httpStatus: 409 });
  });

  it('answers 404 for a booking that is not the caller own', async () => {
    const repository = buildRepository({
      findCancellationFacts: jest.fn().mockResolvedValue(null),
    });

    const error = await errorOf(new CancelBookingUseCase(repository).execute(request));

    expect(error).toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('treats losing a race to another cancellation as success, and to attendance as a refusal', async () => {
    const confirmed = buildBooking();
    const lostToCancellation = buildRepository({
      findCancellationFacts: jest
        .fn()
        .mockResolvedValueOnce(facts(confirmed))
        .mockResolvedValueOnce(
          facts(buildBooking({ status: 'cancelled', cancelWithinPolicy: true })),
        ),
      markCancelled: jest.fn().mockResolvedValue(null),
    });
    const lostToAttendance = buildRepository({
      findCancellationFacts: jest
        .fn()
        .mockResolvedValueOnce(facts(confirmed))
        .mockResolvedValueOnce(facts(buildBooking({ status: 'attended' }))),
      markCancelled: jest.fn().mockResolvedValue(null),
    });

    const first = await new CancelBookingUseCase(lostToCancellation).execute(request);
    const error = await errorOf(new CancelBookingUseCase(lostToAttendance).execute(request));

    expect(first.booking.status).toBe('cancelled');
    expect(error).toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE' });
  });
});

describe('GetDayAgendaUseCase', () => {
  const STAFF: ActorContext = { ...CLIENT, role: 'staff', membershipId: 'membership-staff' };
  const OWNER: ActorContext = { ...CLIENT, role: 'owner', membershipId: 'membership-owner' };

  it('keeps staff on their own agenda whatever they ask for, and lets admins filter', async () => {
    const listDayAgenda = jest.fn().mockResolvedValue({ timeZone: 'Europe/Madrid', entries: [] });
    const useCase = new GetDayAgendaUseCase(buildRepository({ listDayAgenda }));
    const date = '2026-10-05';

    await useCase.execute({ actor: STAFF, date, requestedStaffMembershipId: 'membership-owner' });
    await useCase.execute({ actor: OWNER, date, requestedStaffMembershipId: 'membership-staff' });
    await useCase.execute({ actor: OWNER, date, requestedStaffMembershipId: null });

    expect(
      listDayAgenda.mock.calls.map(
        ([, query]) => (query as { staffMembershipId: string | null }).staffMembershipId,
      ),
    ).toEqual(['membership-staff', 'membership-staff', null]);
  });
});

describe('RescheduleBookingByTeamUseCase', () => {
  const staff: ActorContext = { ...CLIENT, membershipId: 'membership-staff', role: 'staff' };
  const command = {
    bookingId: 'booking-1',
    startsAt: new Date(NOW.getTime() + 72 * HOUR_MS),
    now: NOW,
  };

  it('returns the moved booking', async () => {
    const booking = buildBooking({ startsAt: command.startsAt });
    const repository = buildRepository({
      rescheduleByTeam: jest
        .fn()
        .mockResolvedValue({ kind: 'rescheduled', booking, hasChangedTime: true }),
    });

    const outcome = await new RescheduleBookingByTeamUseCase(repository).execute(staff, command);

    expect(outcome.booking).toBe(booking);
  });

  it.each([
    { kind: 'not_found', code: 'NOT_FOUND', status: 404 },
    { kind: 'not_reschedulable', code: 'BOOKING_NOT_RESCHEDULABLE', status: 409 },
    { kind: 'outside_window', code: 'OUTSIDE_BOOKING_WINDOW', status: 409 },
    { kind: 'slot_unavailable', code: 'SLOT_UNAVAILABLE', status: 409 },
    { kind: 'already_booked', code: 'ALREADY_BOOKED', status: 409 },
  ] as const)('maps "$kind" to $status $code', async ({ kind, code, status }) => {
    const outcome: RescheduleOutcome = { kind };
    const repository = buildRepository({ rescheduleByTeam: jest.fn().mockResolvedValue(outcome) });

    const error = await errorOf(
      new RescheduleBookingByTeamUseCase(repository).execute(staff, command),
    );

    expect(error).toMatchObject({ code, httpStatus: status });
  });
});
