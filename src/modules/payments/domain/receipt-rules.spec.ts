import { buildReceiptNumber, isFiscalDataComplete, splitVatIncluded } from './receipt-rules';

describe('splitVatIncluded', () => {
  it.each([
    { totalCents: 12100, baseCents: 10000, vatCents: 2100 },
    { totalCents: 5000, baseCents: 4132, vatCents: 868 },
    { totalCents: 1, baseCents: 1, vatCents: 0 },
    { totalCents: 0, baseCents: 0, vatCents: 0 },
    { totalCents: 99999, baseCents: 82644, vatCents: 17355 },
  ])('splits $totalCents', ({ totalCents, baseCents, vatCents }) => {
    const split = splitVatIncluded(totalCents);

    expect(split).toEqual({ baseCents, vatCents });
    expect(split.baseCents + split.vatCents).toBe(totalCents);
  });
});

describe('buildReceiptNumber', () => {
  it.each([
    { year: 2026, sequence: 1, expected: '2026-000001' },
    { year: 2026, sequence: 123, expected: '2026-000123' },
    { year: 2027, sequence: 1_000_000, expected: '2027-1000000' },
  ])('numbers $expected', ({ year, sequence, expected }) => {
    expect(buildReceiptNumber({ year, sequence })).toBe(expected);
  });
});

describe('isFiscalDataComplete', () => {
  const COMPLETE = { legalName: 'Academia SL', taxId: 'B12345678', taxAddress: 'Calle Mayor 1' };

  it.each([
    ['all three filled in', COMPLETE, true],
    ['no legal name', { ...COMPLETE, legalName: null }, false],
    ['no tax id', { ...COMPLETE, taxId: null }, false],
    ['no address', { ...COMPLETE, taxAddress: null }, false],
    ['a blank address', { ...COMPLETE, taxAddress: '   ' }, false],
  ])('%s', (_name, center, expected) => {
    expect(isFiscalDataComplete(center)).toBe(expected);
  });
});
