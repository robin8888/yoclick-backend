import {
  formatInvitationCode,
  generateInvitationCode,
  hashInvitationCode,
  maskEmailAddress,
  normalizeInvitationCode,
} from './invitation-code';

describe('generateInvitationCode', () => {
  it('has twelve unambiguous characters and does not repeat', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInvitationCode()));

    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });
});

describe('formatInvitationCode and normalizeInvitationCode', () => {
  it('round-trips through the grouped form', () => {
    const code = generateInvitationCode();

    expect(formatInvitationCode(code)).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    expect(normalizeInvitationCode(formatInvitationCode(code))).toBe(code);
  });

  it('tolerates lower case and spaces', () => {
    expect(normalizeInvitationCode(' abcd efgh jklm ')).toBe('ABCDEFGHJKLM');
  });

  it.each(['', 'ABCD-EFGH', 'ABCDEFGHJKLMN', 'ABCD-EFGH-JKL0', 'ABCD-EFGH-JKL!', "ABCDEFGHJKL'"])(
    'rejects %j',
    (rawCode) => {
      expect(normalizeInvitationCode(rawCode)).toBeNull();
    },
  );
});

describe('hashInvitationCode', () => {
  it('is deterministic and never contains the code', () => {
    expect(hashInvitationCode('ABCDEFGHJKLM')).toBe(hashInvitationCode('ABCDEFGHJKLM'));
    expect(hashInvitationCode('ABCDEFGHJKLM')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('maskEmailAddress', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmailAddress('robin@yopmail.com')).toBe('r***@yopmail.com');
  });
});
