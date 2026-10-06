import { calculateOccupancyPercent, getWeekOfLocalDate, sumOpenMinutes } from './day-summary';

const OPENING_HOURS = {
  tue: [
    { opensAt: '09:00', closesAt: '14:00' },
    { opensAt: '16:00', closesAt: '20:00' },
  ],
};

describe('sumOpenMinutes', () => {
  it.each([
    ['a day with two intervals', '2026-09-29', [], 540],
    ['a day the center does not open', '2026-09-30', [], 0],
    ['a holiday', '2026-09-29', ['2026-09-29'], 0],
  ])('%s', (_name, date, holidayDates, expectedMinutes) => {
    expect(sumOpenMinutes(OPENING_HOURS, holidayDates, date)).toBe(expectedMinutes);
  });

  it('is zero when the center has no opening hours', () => {
    expect(sumOpenMinutes(null, [], '2026-09-29')).toBe(0);
  });
});

describe('calculateOccupancyPercent', () => {
  it.each([
    [{ bookedMinutes: 270, openMinutes: 540, staffCount: 1 }, 50],
    [{ bookedMinutes: 270, openMinutes: 540, staffCount: 2 }, 25],
    [{ bookedMinutes: 1000, openMinutes: 540, staffCount: 1 }, 100],
    [{ bookedMinutes: 0, openMinutes: 540, staffCount: 3 }, 0],
    [{ bookedMinutes: 60, openMinutes: 0, staffCount: 2 }, null],
    [{ bookedMinutes: 60, openMinutes: 540, staffCount: 0 }, null],
  ])('%j gives %p', (input, expectedPercent) => {
    expect(calculateOccupancyPercent(input)).toBe(expectedPercent);
  });
});

describe('getWeekOfLocalDate', () => {
  it.each([
    ['a Monday', '2026-09-28', '2026-09-28', '2026-10-04'],
    ['a Tuesday', '2026-09-29', '2026-09-28', '2026-10-04'],
    ['a Sunday', '2026-10-04', '2026-09-28', '2026-10-04'],
  ])('%s', (_name, date, fromDate, toDate) => {
    expect(getWeekOfLocalDate(date)).toEqual({ fromDate, toDate });
  });
});
