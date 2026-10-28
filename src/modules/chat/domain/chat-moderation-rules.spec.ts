import { canReportMessage, decideBlock, findOtherPerson } from './chat-moderation-rules';

describe('decideBlock', () => {
  it.each([
    { name: 'a client blocks a teacher', actorRole: 'client', targetRole: 'staff', allowed: true },
    { name: 'a teacher blocks a client', actorRole: 'staff', targetRole: 'client', allowed: true },
    {
      name: 'a client blocks another client',
      actorRole: 'client',
      targetRole: 'client',
      allowed: false,
    },
    {
      name: 'a teacher blocks another teacher',
      actorRole: 'staff',
      targetRole: 'staff',
      allowed: false,
    },
    { name: 'a client blocks the owner', actorRole: 'client', targetRole: 'owner', allowed: false },
    {
      name: 'a client blocks an administrator',
      actorRole: 'client',
      targetRole: 'admin',
      allowed: false,
    },
    {
      name: 'a teacher blocks an administrator',
      actorRole: 'staff',
      targetRole: 'admin',
      allowed: false,
    },
    { name: 'the owner blocks a client', actorRole: 'owner', targetRole: 'client', allowed: false },
    {
      name: 'an administrator blocks a teacher',
      actorRole: 'admin',
      targetRole: 'staff',
      allowed: false,
    },
  ] as const)('when $name it is allowed: $allowed', ({ actorRole, targetRole, allowed }) => {
    const decision = decideBlock({ actorRole, targetRole, isSamePerson: false });

    expect(decision.kind).toBe(allowed ? 'allowed' : 'denied');
  });

  it('never lets someone block themselves', () => {
    expect(decideBlock({ actorRole: 'client', targetRole: 'staff', isSamePerson: true })).toEqual({
      kind: 'denied',
      code: 'CHAT_BLOCK_NOT_ALLOWED',
    });
  });
});

describe('canReportMessage', () => {
  it.each([
    { name: 'someone else wrote it', reporter: 'ana', sender: 'luis', expected: true },
    { name: 'the reporter wrote it', reporter: 'ana', sender: 'ana', expected: false },
  ])('is $expected when $name', ({ reporter, sender, expected }) => {
    expect(canReportMessage({ reporterMembershipId: reporter, senderMembershipId: sender })).toBe(
      expected,
    );
  });
});

describe('findOtherPerson', () => {
  it.each([
    { name: 'the member looks', viewer: 'ana', counterpart: 'teacher', expected: 'teacher' },
    { name: 'the counterpart looks', viewer: 'teacher', counterpart: 'teacher', expected: 'ana' },
    {
      name: 'it is a conversation with the center',
      viewer: 'ana',
      counterpart: null,
      expected: null,
    },
  ])('is $expected when $name', ({ viewer, counterpart, expected }) => {
    expect(
      findOtherPerson({
        viewerMembershipId: viewer,
        memberMembershipId: 'ana',
        counterpartMembershipId: counterpart,
      }),
    ).toBe(expected);
  });
});
