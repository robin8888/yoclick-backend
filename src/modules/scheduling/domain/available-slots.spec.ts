import { findBookableSlot } from './find-bookable-slot';
import {
  calculateAvailableSlots,
  type BusyInterval,
  type SlotCalculationInput,
  type StaffCandidate,
} from './available-slots';

const MADRID = 'Europe/Madrid';
const ANA: StaffCandidate = {
  membershipId: '00000000-0000-7000-8000-00000000000a',
  fullName: 'Ana',
};
const BEA: StaffCandidate = {
  membershipId: '00000000-0000-7000-8000-00000000000b',
  fullName: 'Bea',
};
const TWO_SPLIT_SHIFTS = [
  { opensAt: '09:00', closesAt: '14:00' },
  { opensAt: '16:00', closesAt: '20:00' },
];
/** Un lunes bien anterior a cualquier fecha de los casos: la ventana y la antelación no estorban. */
const LONG_AGO = new Date('2026-01-01T00:00:00Z');

function buildInput(overrides: Partial<SlotCalculationInput> = {}): SlotCalculationInput {
  return {
    timeZone: MADRID,
    openingHours: { mon: TWO_SPLIT_SHIFTS, tue: TWO_SPLIT_SHIFTS, sun: [] },
    holidayDates: [],
    fromDate: '2026-10-05',
    toDate: '2026-10-05',
    durationMinutes: 60,
    minNoticeMinutes: 120,
    bookingWindowDays: 1_000,
    now: LONG_AGO,
    staff: [ANA],
    busyIntervals: [],
    ...overrides,
  };
}

function startsOf(input: SlotCalculationInput): string[] {
  return calculateAvailableSlots(input).flatMap((day) =>
    day.slots.map((slot) => slot.startsAt.toISOString()),
  );
}

function busy(staff: StaffCandidate, startsAt: string, endsAt: string): BusyInterval {
  return {
    staffMembershipId: staff.membershipId,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  };
}

describe('calculateAvailableSlots', () => {
  it('builds a grid from the opening of each shift in the center time zone', () => {
    // Lunes 5 de octubre de 2026: horario de verano (UTC+2).
    expect(startsOf(buildInput())).toEqual([
      '2026-10-05T07:00:00.000Z',
      '2026-10-05T08:00:00.000Z',
      '2026-10-05T09:00:00.000Z',
      '2026-10-05T10:00:00.000Z',
      '2026-10-05T11:00:00.000Z',
      '2026-10-05T14:00:00.000Z',
      '2026-10-05T15:00:00.000Z',
      '2026-10-05T16:00:00.000Z',
      '2026-10-05T17:00:00.000Z',
    ]);
  });

  it('only offers slots that fit entirely inside a shift', () => {
    const slots = startsOf(buildInput({ durationMinutes: 90 }));

    // 09:00-14:00 admite 3 huecos de 90 min (09:00, 10:30, 12:00); 16:00-20:00 admite 2 (16:00, 17:30).
    expect(slots).toEqual([
      '2026-10-05T07:00:00.000Z',
      '2026-10-05T08:30:00.000Z',
      '2026-10-05T10:00:00.000Z',
      '2026-10-05T14:00:00.000Z',
      '2026-10-05T15:30:00.000Z',
    ]);
  });

  it('offers nothing when the service is longer than every shift', () => {
    expect(startsOf(buildInput({ durationMinutes: 300 }))).toEqual(['2026-10-05T07:00:00.000Z']);
    expect(startsOf(buildInput({ durationMinutes: 480 }))).toEqual([]);
  });

  it('returns closed days and days without any hours with an empty slot list', () => {
    const days = calculateAvailableSlots(
      buildInput({ fromDate: '2026-10-10', toDate: '2026-10-11', openingHours: null }),
    );

    expect(days).toEqual([
      { date: '2026-10-10', slots: [] },
      { date: '2026-10-11', slots: [] },
    ]);
  });

  it('returns no slots on holidays but keeps the neighbouring days', () => {
    const days = calculateAvailableSlots(
      buildInput({ fromDate: '2026-10-05', toDate: '2026-10-06', holidayDates: ['2026-10-05'] }),
    );

    expect(days.map((day) => day.slots.length)).toEqual([0, 9]);
  });

  it('removes the slots that overlap an existing session of the only professional', () => {
    const slots = startsOf(
      buildInput({ busyIntervals: [busy(ANA, '2026-10-05T08:30:00Z', '2026-10-05T09:30:00Z')] }),
    );

    // Una sesión 10:30-11:30 (hora local) bloquea los huecos de 10:00 y de 11:00.
    expect(slots).not.toContain('2026-10-05T08:00:00.000Z');
    expect(slots).not.toContain('2026-10-05T09:00:00.000Z');
    expect(slots).toContain('2026-10-05T07:00:00.000Z');
    expect(slots).toContain('2026-10-05T10:00:00.000Z');
  });

  it('lets a session end exactly when the next slot starts', () => {
    const slots = startsOf(
      buildInput({ busyIntervals: [busy(ANA, '2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z')] }),
    );

    expect(slots[0]).toBe('2026-10-05T08:00:00.000Z');
  });

  describe('notice and booking window', () => {
    it.each([
      {
        case: 'drops slots before the minimum notice',
        now: '2026-10-05T06:00:00Z',
        minNoticeMinutes: 120,
        firstSlot: '2026-10-05T08:00:00.000Z',
      },
      {
        case: 'keeps a slot that starts exactly at the minimum notice',
        now: '2026-10-05T05:00:00Z',
        minNoticeMinutes: 120,
        firstSlot: '2026-10-05T07:00:00.000Z',
      },
      {
        case: 'drops everything of a day that is already over',
        now: '2026-10-05T20:00:00Z',
        minNoticeMinutes: 0,
        firstSlot: undefined,
      },
    ])('$case', ({ now, minNoticeMinutes, firstSlot }) => {
      const slots = startsOf(buildInput({ now: new Date(now), minNoticeMinutes }));

      expect(slots[0]).toBe(firstSlot);
    });

    it('drops days beyond the booking window', () => {
      const days = calculateAvailableSlots(
        buildInput({
          fromDate: '2026-10-05',
          toDate: '2026-10-06',
          now: new Date('2026-10-04T12:00:00Z'),
          bookingWindowDays: 2,
        }),
      );

      // La ventana acaba el martes 6 a las 12:00Z: el lunes entra entero y del martes solo la mañana.
      expect(days.map((day) => day.slots.length)).toEqual([9, 5]);
    });
  });

  describe('several professionals', () => {
    it('offers one slot per start time, with the least busy professional first', () => {
      const [day] = calculateAvailableSlots(
        buildInput({
          staff: [ANA, BEA],
          busyIntervals: [busy(ANA, '2026-10-05T14:00:00Z', '2026-10-05T15:00:00Z')],
        }),
      );

      const morningSlot = day?.slots[0];
      expect(morningSlot?.freeStaff.map(({ fullName }) => fullName)).toEqual(['Bea', 'Ana']);
      const afternoonSlotWithAnaBusy = day?.slots.find(
        (slot) => slot.startsAt.toISOString() === '2026-10-05T14:00:00.000Z',
      );
      expect(afternoonSlotWithAnaBusy?.freeStaff.map(({ fullName }) => fullName)).toEqual(['Bea']);
    });

    it('breaks ties by id so the answer is stable', () => {
      const [day] = calculateAvailableSlots(buildInput({ staff: [BEA, ANA] }));

      expect(day?.slots[0]?.freeStaff.map(({ fullName }) => fullName)).toEqual(['Ana', 'Bea']);
    });

    it('keeps a start time while at least one professional is free and drops it when nobody is', () => {
      const bothBusyAtNine = [
        busy(ANA, '2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z'),
        busy(BEA, '2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z'),
      ];

      expect(
        startsOf(buildInput({ staff: [ANA, BEA], busyIntervals: [bothBusyAtNine[0]!] })),
      ).toContain('2026-10-05T07:00:00.000Z');
      expect(
        startsOf(buildInput({ staff: [ANA, BEA], busyIntervals: bothBusyAtNine })),
      ).not.toContain('2026-10-05T07:00:00.000Z');
    });

    it('offers nothing when the service has nobody to attend it', () => {
      expect(startsOf(buildInput({ staff: [] }))).toEqual([]);
    });
  });

  describe('daylight saving time changes', () => {
    const nightAndMorning = { sun: [{ opensAt: '01:00', closesAt: '05:00' }] };

    it('measures the spring change in real time: 01:00-05:00 local only lasts 3 real hours', () => {
      // Domingo 28 de marzo de 2027: a las 02:00 los relojes saltan a las 03:00.
      const slots = startsOf(
        buildInput({
          openingHours: nightAndMorning,
          fromDate: '2027-03-28',
          toDate: '2027-03-28',
          now: LONG_AGO,
        }),
      );

      // 01:00 (UTC+1) es 00:00Z y las 05:00 (UTC+2) son 03:00Z: tres horas reales, tres huecos.
      expect(slots).toEqual([
        '2027-03-28T00:00:00.000Z',
        '2027-03-28T01:00:00.000Z',
        '2027-03-28T02:00:00.000Z',
      ]);
    });

    it('measures the autumn change in real time: 01:00-05:00 local lasts 5 real hours', () => {
      // Domingo 25 de octubre de 2026: a las 03:00 los relojes vuelven a las 02:00.
      const slots = startsOf(
        buildInput({
          openingHours: nightAndMorning,
          fromDate: '2026-10-25',
          toDate: '2026-10-25',
          now: LONG_AGO,
        }),
      );

      expect(slots).toHaveLength(5);
      expect(slots[0]).toBe('2026-10-24T23:00:00.000Z');
      expect(slots.at(-1)).toBe('2026-10-25T03:00:00.000Z');
    });

    it('keeps a normal 09:00 opening at the same local time on both sides of the change', () => {
      const openingHours = { sat: TWO_SPLIT_SHIFTS, sun: TWO_SPLIT_SHIFTS, mon: TWO_SPLIT_SHIFTS };
      const [saturday, sunday, monday] = calculateAvailableSlots(
        buildInput({ openingHours, fromDate: '2027-03-27', toDate: '2027-03-29' }),
      );

      expect(saturday?.slots[0]?.startsAt.toISOString()).toBe('2027-03-27T08:00:00.000Z');
      expect(sunday?.slots[0]?.startsAt.toISOString()).toBe('2027-03-28T07:00:00.000Z');
      expect(monday?.slots[0]?.startsAt.toISOString()).toBe('2027-03-29T07:00:00.000Z');
    });
  });
});

describe('findBookableSlot', () => {
  const scheduling = buildInput();
  const NINE_LOCAL = new Date('2026-10-05T07:00:00Z');

  it('accepts a start time that matches a slot of the grid', () => {
    const decision = findBookableSlot({
      scheduling,
      startsAt: NINE_LOCAL,
      preferredStaffMembershipId: null,
    });

    expect(decision).toMatchObject({
      kind: 'bookable',
      slot: { freeStaff: [{ fullName: 'Ana' }] },
    });
  });

  it.each([
    { case: 'a time between two slots', startsAt: '2026-10-05T07:30:00Z' },
    { case: 'a time outside the opening hours', startsAt: '2026-10-05T03:00:00Z' },
    { case: 'a closed day', startsAt: '2026-10-11T08:00:00Z' },
  ])('rejects $case as unavailable', ({ startsAt }) => {
    const decision = findBookableSlot({
      scheduling,
      startsAt: new Date(startsAt),
      preferredStaffMembershipId: null,
    });

    expect(decision).toEqual({ kind: 'slot_unavailable' });
  });

  it('tells apart a start that is too soon or too far from one that is merely taken', () => {
    const tooSoon = findBookableSlot({
      scheduling: { ...scheduling, now: new Date('2026-10-05T06:00:00Z') },
      startsAt: NINE_LOCAL,
      preferredStaffMembershipId: null,
    });
    const tooFar = findBookableSlot({
      scheduling: { ...scheduling, bookingWindowDays: 1, now: new Date('2026-10-01T00:00:00Z') },
      startsAt: NINE_LOCAL,
      preferredStaffMembershipId: null,
    });

    expect(tooSoon).toEqual({ kind: 'outside_window' });
    expect(tooFar).toEqual({ kind: 'outside_window' });
  });

  it('reports a taken slot as unavailable, and honours the professional asked for', () => {
    const withAnaBusy = {
      ...scheduling,
      staff: [ANA, BEA],
      busyIntervals: [busy(ANA, '2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z')],
    };

    const askingForAna = findBookableSlot({
      scheduling: withAnaBusy,
      startsAt: NINE_LOCAL,
      preferredStaffMembershipId: ANA.membershipId,
    });
    const askingForBea = findBookableSlot({
      scheduling: withAnaBusy,
      startsAt: NINE_LOCAL,
      preferredStaffMembershipId: BEA.membershipId,
    });

    expect(askingForAna).toEqual({ kind: 'slot_unavailable' });
    expect(askingForBea).toMatchObject({
      kind: 'bookable',
      slot: { freeStaff: [{ fullName: 'Bea' }] },
    });
  });
});
