import { calculateAvailableSlots, type StaffCandidate } from './available-slots';
import { isAbsentOnDate, isStaffAvailableForSlot } from './staff-availability';

const MADRID = 'Europe/Madrid';
const LONG_AGO = new Date('2026-01-01T00:00:00Z');
// Lunes 5 de octubre de 2026: horario de verano (UTC+2).
const MONDAY = '2026-10-05';
const slot = (startsAtUtc: string, endsAtUtc: string) => ({
  startsAt: new Date(startsAtUtc),
  endsAt: new Date(endsAtUtc),
});

describe('isAbsentOnDate', () => {
  it.each([
    ['the first day', '2026-10-05', true],
    ['a day in the middle', '2026-10-06', true],
    ['the last day', '2026-10-07', true],
    ['the day before', '2026-10-04', false],
    ['the day after', '2026-10-08', false],
  ])('on %s', (_name, date, expected) => {
    expect(isAbsentOnDate([{ startsOn: '2026-10-05', endsOn: '2026-10-07' }], date)).toBe(expected);
  });

  it('is never absent without absences', () => {
    expect(isAbsentOnDate([], MONDAY)).toBe(false);
  });
});

describe('isStaffAvailableForSlot', () => {
  const morningOnly = { mon: [{ opensAt: '09:00', closesAt: '13:00' }] };

  it.each([
    ['inside the own hours', '2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z', true],
    ['ending exactly when the own hours end', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', true],
    ['starting before the own hours', '2026-10-05T06:30:00Z', '2026-10-05T07:30:00Z', false],
    [
      'running over the end of the own hours',
      '2026-10-05T10:30:00Z',
      '2026-10-05T11:30:00Z',
      false,
    ],
    [
      'in the afternoon, out of the own hours',
      '2026-10-05T14:00:00Z',
      '2026-10-05T15:00:00Z',
      false,
    ],
  ])('%s', (_name, startsAt, endsAt, expected) => {
    expect(
      isStaffAvailableForSlot({ weeklyHours: morningOnly }, slot(startsAt, endsAt), MADRID),
    ).toBe(expected);
  });

  it('follows the center hours when there are no own hours', () => {
    expect(
      isStaffAvailableForSlot(
        { weeklyHours: null },
        slot('2026-10-05T14:00:00Z', '2026-10-05T15:00:00Z'),
        MADRID,
      ),
    ).toBe(true);
  });

  it('does not work on a weekday the own hours leave empty', () => {
    expect(
      isStaffAvailableForSlot(
        { weeklyHours: morningOnly },
        slot('2026-10-06T07:00:00Z', '2026-10-06T08:00:00Z'),
        MADRID,
      ),
    ).toBe(false);
  });

  it('is not available on an absence day, whatever the hours', () => {
    const rules = { absences: [{ startsOn: MONDAY, endsOn: MONDAY }] };

    expect(
      isStaffAvailableForSlot(rules, slot('2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z'), MADRID),
    ).toBe(false);
  });
});

describe('calculateAvailableSlots with the availability of each person', () => {
  const ANA: StaffCandidate = { membershipId: 'ana', fullName: 'Ana' };
  const BEA: StaffCandidate = {
    membershipId: 'bea',
    fullName: 'Bea',
    weeklyHours: { mon: [{ opensAt: '09:00', closesAt: '10:00' }] },
  };
  const input = (staff: StaffCandidate[]) => ({
    timeZone: MADRID,
    openingHours: { mon: [{ opensAt: '09:00', closesAt: '12:00' }] },
    holidayDates: [],
    fromDate: MONDAY,
    toDate: MONDAY,
    durationMinutes: 60,
    minNoticeMinutes: 0,
    bookingWindowDays: 1_000,
    now: LONG_AGO,
    staff,
    busyIntervals: [],
  });
  const freeNames = (staff: StaffCandidate[]) =>
    calculateAvailableSlots(input(staff))[0]?.slots.map((slotOfDay) =>
      slotOfDay.freeStaff.map(({ fullName }) => fullName).join('+'),
    );

  it('offers each person only inside their own hours', () => {
    expect(freeNames([ANA, BEA])).toEqual(['Ana+Bea', 'Ana', 'Ana']);
  });

  it('offers nothing when the only person is away that day', () => {
    const away = { ...ANA, absences: [{ startsOn: MONDAY, endsOn: MONDAY }] };

    expect(freeNames([away])).toEqual([]);
  });

  it('keeps offering the others when one person is away', () => {
    const away = { ...ANA, absences: [{ startsOn: MONDAY, endsOn: MONDAY }] };

    expect(freeNames([away, BEA])).toEqual(['Bea']);
  });
});
