import { fillMonthlySeries, getSeriesStart, listRecentMonthKeys } from './monthly-series';

describe('listRecentMonthKeys', () => {
  it('lists the last months up to the current one, oldest first', () => {
    expect(listRecentMonthKeys(new Date('2026-10-21T10:00:00Z'), 3)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });

  it('crosses the year boundary', () => {
    expect(listRecentMonthKeys(new Date('2027-02-01T00:00:00Z'), 4)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('gives twelve months for a year', () => {
    const keys = listRecentMonthKeys(new Date('2026-10-21T10:00:00Z'), 12);

    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('2025-11');
    expect(keys.at(-1)).toBe('2026-10');
  });
});

describe('getSeriesStart', () => {
  it('starts at the first instant of the oldest month', () => {
    expect(getSeriesStart(new Date('2026-10-21T10:00:00Z'), 12).toISOString()).toBe(
      '2025-11-01T00:00:00.000Z',
    );
  });
});

describe('fillMonthlySeries', () => {
  it('puts zero in the months without data and keeps the order', () => {
    const series = fillMonthlySeries(
      ['2026-08', '2026-09', '2026-10'],
      [
        { month: '2026-10', count: 4 },
        { month: '2026-08', count: 1 },
      ],
    );

    expect(series).toEqual([
      { month: '2026-08', count: 1 },
      { month: '2026-09', count: 0 },
      { month: '2026-10', count: 4 },
    ]);
  });

  it('ignores months outside the requested range', () => {
    expect(fillMonthlySeries(['2026-10'], [{ month: '2020-01', count: 9 }])).toEqual([
      { month: '2026-10', count: 0 },
    ]);
  });
});
