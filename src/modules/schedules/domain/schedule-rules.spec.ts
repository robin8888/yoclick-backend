import {
  findSkipReason,
  getScheduleWeekdayOfLocalDate,
  isModeAllowedByService,
  listOccurrenceDates,
  resolvePendingWindow,
  resolveSessionCapacity,
} from './schedule-rules';

describe('schedule rules', () => {
  describe('getScheduleWeekdayOfLocalDate', () => {
    it.each([
      ['2026-10-12', 1],
      ['2026-10-15', 4],
      ['2026-10-18', 7],
    ])('%s is weekday %i (1 = Monday)', (date, weekday) => {
      expect(getScheduleWeekdayOfLocalDate(date)).toBe(weekday);
    });
  });

  describe('listOccurrenceDates', () => {
    it('lists the Thursdays of the window inside the period', () => {
      const dates = listOccurrenceDates(
        { weekday: 4, startsOn: '2026-10-01', endsOn: '2026-10-31' },
        { fromDate: '2026-10-12', toDate: '2026-11-30' },
      );

      expect(dates).toEqual(['2026-10-15', '2026-10-22', '2026-10-29']);
    });

    it('starts at the period start when the window begins earlier', () => {
      const dates = listOccurrenceDates(
        { weekday: 1, startsOn: '2026-10-19', endsOn: null },
        { fromDate: '2026-10-01', toDate: '2026-10-31' },
      );

      expect(dates).toEqual(['2026-10-19', '2026-10-26']);
    });

    it('is empty when the period and the window do not meet', () => {
      expect(
        listOccurrenceDates(
          { weekday: 1, startsOn: '2026-12-01', endsOn: null },
          { fromDate: '2026-10-01', toDate: '2026-10-31' },
        ),
      ).toEqual([]);
      expect(
        listOccurrenceDates(
          { weekday: 1, startsOn: '2026-01-01', endsOn: '2026-09-30' },
          { fromDate: '2026-10-01', toDate: '2026-10-31' },
        ),
      ).toEqual([]);
    });
  });

  describe('resolvePendingWindow', () => {
    it('covers today plus the horizon when nothing exists yet', () => {
      expect(resolvePendingWindow({ today: '2026-10-12', materializedUntil: null })).toEqual({
        fromDate: '2026-10-12',
        toDate: '2026-12-07',
      });
    });

    it('continues the day after the last materialized date', () => {
      expect(
        resolvePendingWindow({ today: '2026-10-12', materializedUntil: '2026-11-20' }),
      ).toEqual({ fromDate: '2026-11-21', toDate: '2026-12-07' });
    });

    it('never goes back in time when the last date is in the past', () => {
      expect(
        resolvePendingWindow({ today: '2026-10-12', materializedUntil: '2026-10-01' }),
      ).toEqual({ fromDate: '2026-10-12', toDate: '2026-12-07' });
    });

    it('is null when the horizon is already covered', () => {
      expect(
        resolvePendingWindow({ today: '2026-10-12', materializedUntil: '2026-12-07' }),
      ).toBeNull();
    });
  });

  describe('findSkipReason', () => {
    const absences = [{ startsOn: '2026-10-20', endsOn: '2026-10-22' }];

    it.each([
      ['2026-10-12', [], 'holiday'],
      ['2026-10-21', [], 'absence'],
      ['2026-10-20', [], 'absence'],
      ['2026-10-22', [], 'absence'],
      ['2026-10-23', [], null],
    ])('%s → %s', (date, holidayDates, expected) => {
      expect(
        findSkipReason({ date, holidayDates: ['2026-10-12', ...holidayDates], absences }),
      ).toBe(expected);
    });
  });

  describe('resolveSessionCapacity', () => {
    it.each([
      ['private', 20, 5, 1],
      ['group', 20, null, 20],
      ['group', 20, 8, 8],
      ['group', 20, 50, 20],
      ['group', null, 12, 12],
      ['group', 20, 0, 1],
    ] as const)('%s in room of %s with %s requested → %i', (mode, room, requested, expected) => {
      expect(
        resolveSessionCapacity({ mode, roomCapacity: room, requestedCapacity: requested }),
      ).toBe(expected);
    });
  });

  describe('isModeAllowedByService', () => {
    it.each([
      ['private', 'private', true],
      ['private', 'group', false],
      ['group', 'group', true],
      ['group', 'private', false],
      ['both', 'private', true],
      ['both', 'group', true],
    ] as const)('service %s with session %s → %s', (serviceMode, sessionMode, expected) => {
      expect(isModeAllowedByService(serviceMode, sessionMode)).toBe(expected);
    });
  });
});
