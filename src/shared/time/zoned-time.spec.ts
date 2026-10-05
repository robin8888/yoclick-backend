import {
  addDaysToLocalDate,
  daysBetweenLocalDates,
  getUtcRangeOfLocalDates,
  getWeekdayOfLocalDate,
  listLocalDates,
  toLocalDate,
  zonedDateTimeToUtc,
} from './zoned-time';

const MADRID = 'Europe/Madrid';
const MILLISECONDS_PER_HOUR = 3_600_000;

describe('zonedDateTimeToUtc', () => {
  it.each([
    { case: 'winter (UTC+1)', date: '2026-01-15', time: '09:00', utc: '2026-01-15T08:00:00.000Z' },
    { case: 'summer (UTC+2)', date: '2026-07-15', time: '09:00', utc: '2026-07-15T07:00:00.000Z' },
    {
      case: 'the morning after the clocks go forward',
      date: '2027-03-28',
      time: '09:00',
      utc: '2027-03-28T07:00:00.000Z',
    },
    {
      case: 'the night before the clocks go forward',
      date: '2027-03-27',
      time: '23:00',
      utc: '2027-03-27T22:00:00.000Z',
    },
    {
      case: 'the morning after the clocks go back',
      date: '2026-10-25',
      time: '09:00',
      utc: '2026-10-25T08:00:00.000Z',
    },
    {
      case: 'the night before the clocks go back',
      date: '2026-10-24',
      time: '23:00',
      utc: '2026-10-24T21:00:00.000Z',
    },
    {
      case: 'a time skipped by the spring change (moves forward)',
      date: '2027-03-28',
      time: '02:30',
      utc: '2027-03-28T01:30:00.000Z',
    },
    {
      case: 'a repeated autumn time (the later one)',
      date: '2026-10-25',
      time: '02:30',
      utc: '2026-10-25T01:30:00.000Z',
    },
  ])('converts $case', ({ date, time, utc }) => {
    expect(zonedDateTimeToUtc(date, time, MADRID).toISOString()).toBe(utc);
  });

  it('works for zones west of UTC', () => {
    expect(zonedDateTimeToUtc('2026-07-01', '09:00', 'America/Mexico_City').toISOString()).toBe(
      '2026-07-01T15:00:00.000Z',
    );
  });
});

describe('local date helpers', () => {
  it('reads the local date of an instant in the center zone', () => {
    const lateEveningUtc = new Date('2026-07-15T22:30:00Z');

    expect(toLocalDate(lateEveningUtc, MADRID)).toBe('2026-07-16');
    expect(toLocalDate(lateEveningUtc, 'UTC')).toBe('2026-07-15');
  });

  it.each([
    { date: '2026-10-05', weekday: 'mon' },
    { date: '2026-10-10', weekday: 'sat' },
    { date: '2026-10-25', weekday: 'sun' },
    { date: '2027-03-28', weekday: 'sun' },
  ])('says $date is a $weekday', ({ date, weekday }) => {
    expect(getWeekdayOfLocalDate(date)).toBe(weekday);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysToLocalDate('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysToLocalDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts the days between two dates and lists them inclusively', () => {
    expect(daysBetweenLocalDates('2026-10-01', '2026-10-15')).toBe(14);
    expect(listLocalDates('2026-10-24', '2026-10-26')).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(listLocalDates('2026-10-26', '2026-10-24')).toEqual([]);
  });

  it('measures the day of a clock change as 23 or 25 real hours', () => {
    const springDay = getUtcRangeOfLocalDates('2027-03-28', '2027-03-28', MADRID);
    const autumnDay = getUtcRangeOfLocalDates('2026-10-25', '2026-10-25', MADRID);
    const hoursOf = (range: { startsAt: Date; endsAt: Date }): number =>
      (range.endsAt.getTime() - range.startsAt.getTime()) / MILLISECONDS_PER_HOUR;

    expect(hoursOf(springDay)).toBe(23);
    expect(hoursOf(autumnDay)).toBe(25);
  });
});
