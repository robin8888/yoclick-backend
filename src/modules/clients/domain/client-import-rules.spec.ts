import {
  classifyImportRows,
  decideImportRowAction,
  type ExistingMembershipFacts,
  type ImportRow,
} from './client-import-rules';

function buildRow(overrides: Partial<ImportRow>): ImportRow {
  return {
    fullName: 'Ana Pérez',
    email: 'ana@example.com',
    phone: null,
    level: null,
    ...overrides,
  };
}

describe('classifyImportRows', () => {
  it('keeps every row that has a different email', () => {
    const rows = [buildRow({ email: 'a@example.com' }), buildRow({ email: 'b@example.com' })];

    const { importable, skipped } = classifyImportRows(rows);

    expect(importable).toHaveLength(2);
    expect(skipped).toEqual([]);
  });

  it.each([
    {
      caseName: 'a row without email',
      rows: [buildRow({ email: null })],
      expected: [{ rowNumber: 1, reason: 'missing_email' }],
    },
    {
      caseName: 'the second row of a repeated email, ignoring case',
      rows: [buildRow({ email: 'A@example.com' }), buildRow({ email: 'a@EXAMPLE.com' })],
      expected: [{ rowNumber: 2, reason: 'duplicated_in_file' }],
    },
  ])('skips $caseName', ({ rows, expected }) => {
    expect(classifyImportRows(rows).skipped).toEqual(expected);
  });

  it('lowercases the email of the rows it keeps', () => {
    const { importable } = classifyImportRows([buildRow({ email: 'Ana@Example.COM' })]);

    expect(importable[0]?.email).toBe('ana@example.com');
  });
});

describe('decideImportRowAction', () => {
  const activeClient: ExistingMembershipFacts = { role: 'client', status: 'active' };

  it.each([
    { caseName: 'a new person', membership: null, seats: 5, expected: 'add_as_client' },
    {
      caseName: 'a new person without a limit',
      membership: null,
      seats: null,
      expected: 'add_as_client',
    },
    {
      caseName: 'a new person with no seats left',
      membership: null,
      seats: 0,
      expected: 'client_limit_reached',
    },
    {
      caseName: 'an active client',
      membership: activeClient,
      seats: 0,
      expected: 'update_existing_client',
    },
    {
      caseName: 'a client who left',
      membership: { role: 'client', status: 'left' },
      seats: 3,
      expected: 'add_as_client',
    },
    {
      caseName: 'a client who left and no seats',
      membership: { role: 'client', status: 'left' },
      seats: 0,
      expected: 'client_limit_reached',
    },
    {
      caseName: 'a blocked client',
      membership: { role: 'client', status: 'blocked' },
      seats: 3,
      expected: 'blocked',
    },
    {
      caseName: 'a staff member',
      membership: { role: 'staff', status: 'active' },
      seats: 3,
      expected: 'team_member',
    },
    {
      caseName: 'a blocked staff member',
      membership: { role: 'staff', status: 'blocked' },
      seats: 3,
      expected: 'blocked',
    },
  ] satisfies {
    caseName: string;
    membership: ExistingMembershipFacts | null;
    seats: number | null;
    expected: string;
  }[])('returns $expected for $caseName', ({ membership, seats, expected }) => {
    expect(decideImportRowAction({ membership, remainingSeats: seats })).toBe(expected);
  });
});
