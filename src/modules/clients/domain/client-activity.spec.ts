import { resolveClientActivity } from './client-activity';

const NOW = new Date('2026-10-06T10:00:00.000Z');
const daysAgo = (dayCount: number): Date => new Date(NOW.getTime() - dayCount * 86_400_000);
const daysAhead = (dayCount: number): Date => new Date(NOW.getTime() + dayCount * 86_400_000);

describe('resolveClientActivity', () => {
  it.each([
    ['joined yesterday without bookings', daysAgo(1), null, 'new'],
    ['joined six days ago', daysAgo(6), daysAgo(2), 'new'],
    ['joined a month ago with a booking last week', daysAgo(30), daysAgo(7), 'active'],
    ['joined long ago with a booking 29 days ago', daysAgo(200), daysAgo(29), 'active'],
    ['joined long ago with an upcoming booking', daysAgo(200), daysAhead(3), 'active'],
    ['joined long ago with a booking 31 days ago', daysAgo(200), daysAgo(31), 'inactive'],
    ['joined long ago and never booked', daysAgo(200), null, 'inactive'],
  ])('%s is %s', (_caseName, joinedAt, lastBookingAt, expectedActivity) => {
    expect(resolveClientActivity({ joinedAt, lastBookingAt, now: NOW })).toBe(expectedActivity);
  });
});
