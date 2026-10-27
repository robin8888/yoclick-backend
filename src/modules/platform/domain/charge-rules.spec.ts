import {
  buildChargesCsv,
  canChargeBeChanged,
  computeChargeAmounts,
  describeChargeChanges,
  getFirstDayAfterMonth,
  summarizeChargesByMonth,
  sumMonthlySummaries,
  type ChargeCsvRow,
  type ReportableCharge,
} from './charge-rules';

function buildCharge(overrides: Partial<ReportableCharge> = {}): ReportableCharge {
  return {
    chargedOn: '2026-10-15',
    status: 'paid',
    baseCents: 7900,
    vatCents: 1659,
    totalCents: 9559,
    stripeFeeCents: null,
    ...overrides,
  };
}

function buildCsvRow(overrides: Partial<ChargeCsvRow> = {}): ChargeCsvRow {
  return {
    ...buildCharge(),
    centerName: 'Studio Norte',
    customerLegalName: 'Studio Norte S.L.',
    customerTaxId: 'B12345678',
    vatBasisPoints: 2100,
    paymentMethod: 'transfer',
    invoiceReference: 'F-2026-001',
    stripeId: null,
    ...overrides,
  };
}

describe('computeChargeAmounts', () => {
  it.each([
    { baseCents: 7900, vatBasisPoints: 2100, vatCents: 1659, totalCents: 9559 },
    { baseCents: 3900, vatBasisPoints: 2100, vatCents: 819, totalCents: 4719 },
    { baseCents: 14900, vatBasisPoints: 2100, vatCents: 3129, totalCents: 18029 },
    { baseCents: 1005, vatBasisPoints: 2100, vatCents: 211, totalCents: 1216 },
    { baseCents: 7900, vatBasisPoints: 0, vatCents: 0, totalCents: 7900 },
    { baseCents: 0, vatBasisPoints: 2100, vatCents: 0, totalCents: 0 },
  ])(
    'applies $vatBasisPoints basis points to $baseCents cents',
    ({ baseCents, vatBasisPoints, vatCents, totalCents }) => {
      expect(computeChargeAmounts({ baseCents, vatBasisPoints })).toEqual({
        baseCents,
        vatCents,
        totalCents,
      });
    },
  );
});

describe('getFirstDayAfterMonth', () => {
  it.each([
    { monthKey: '2026-10', expected: '2026-11-01' },
    { monthKey: '2026-12', expected: '2027-01-01' },
    { monthKey: '2026-01', expected: '2026-02-01' },
  ])('returns $expected after $monthKey', ({ monthKey, expected }) => {
    expect(getFirstDayAfterMonth(monthKey)).toBe(expected);
  });
});

describe('summarizeChargesByMonth', () => {
  it('adds up only the paid charges of each month, in month order', () => {
    const months = summarizeChargesByMonth([
      buildCharge({ chargedOn: '2026-11-02' }),
      buildCharge({ chargedOn: '2026-10-15', stripeFeeCents: 200 }),
      buildCharge({ chargedOn: '2026-10-20', stripeFeeCents: 150 }),
      buildCharge({ chargedOn: '2026-10-21', status: 'void' }),
      buildCharge({ chargedOn: '2026-10-22', status: 'pending' }),
    ]);

    expect(months.map((month) => month.month)).toEqual(['2026-10', '2026-11']);
    expect(months[0]).toMatchObject({
      chargeCount: 2,
      baseCents: 15800,
      vatCents: 3318,
      totalCents: 19118,
      stripeFeeCents: 350,
    });
    expect(months[1]?.chargeCount).toBe(1);
  });

  it('returns nothing when there are no paid charges', () => {
    expect(summarizeChargesByMonth([buildCharge({ status: 'void' })])).toEqual([]);
  });
});

describe('sumMonthlySummaries', () => {
  it('adds the months into one quarter total', () => {
    const months = summarizeChargesByMonth([
      buildCharge({ chargedOn: '2026-10-01' }),
      buildCharge({ chargedOn: '2026-11-01' }),
      buildCharge({ chargedOn: '2026-12-01' }),
    ]);

    expect(sumMonthlySummaries(months)).toEqual({
      baseCents: 23700,
      vatCents: 4977,
      totalCents: 28677,
      chargeCount: 3,
      stripeFeeCents: 0,
    });
  });
});

describe('buildChargesCsv', () => {
  it('writes a header and one line per paid charge with Spanish number format', () => {
    const csv = buildChargesCsv([
      buildCsvRow({ chargedOn: '2026-10-20', centerName: 'Zen' }),
      buildCsvRow({ chargedOn: '2026-10-02', stripeFeeCents: 250 }),
      buildCsvRow({ status: 'void' }),
    ]);
    const lines = csv.trimEnd().split('\r\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Base imponible');
    expect(lines[1]).toBe(
      '2026-10-02;2026-10;Studio Norte;Studio Norte S.L.;B12345678;79,00;21;16,59;95,59;2,50;transfer;F-2026-001;',
    );
    expect(lines[2]?.startsWith('2026-10-20;2026-10;Zen;')).toBe(true);
  });

  it('quotes cells that contain separators or quotes', () => {
    const csv = buildChargesCsv([buildCsvRow({ centerName: 'Pilates; "Sol"' })]);

    expect(csv).toContain('"Pilates; ""Sol"""');
  });

  it.each(['=SUM(A1)', '+34600000000', '-1', '@cmd'])(
    'neutralises the formula-like name %s',
    (centerName) => {
      const csv = buildChargesCsv([buildCsvRow({ centerName })]);

      expect(csv).toContain(`;'${centerName};`);
    },
  );

  it('shows a decimal VAT rate with a comma', () => {
    const csv = buildChargesCsv([buildCsvRow({ vatBasisPoints: 1050 })]);

    expect(csv).toContain(';10,5;');
  });
});

describe('describeChargeChanges', () => {
  const current = { status: 'pending', invoiceReference: null } as const;

  it('records one entry per real change', () => {
    const entries = describeChargeChanges('charge-1', current, {
      status: 'paid',
      invoiceReference: 'F-1',
    });

    expect(entries.map((entry) => entry.action)).toEqual([
      'charge_status_changed',
      'charge_invoice_set',
    ]);
  });

  it('records nothing when the values are the same', () => {
    expect(describeChargeChanges('charge-1', current, { status: 'pending' })).toEqual([]);
  });
});

describe('canChargeBeChanged', () => {
  it.each([
    { status: 'pending', expected: true },
    { status: 'paid', expected: true },
    { status: 'void', expected: false },
  ] as const)('is $expected for a $status charge', ({ status, expected }) => {
    expect(canChargeBeChanged({ status, invoiceReference: null })).toBe(expected);
  });
});
