import { planBookingNotices, selectNotificationRecipients } from './notification-rules';

describe('selectNotificationRecipients', () => {
  it.each([
    [
      'staff and administrators, without repeating',
      'staff',
      ['owner', 'admin', 'staff'],
      'client',
      ['staff', 'owner', 'admin'],
    ],
    ['not the person who did it', 'staff', ['owner'], 'staff', ['owner']],
    ['the owner who gives the class and booked it', 'owner', ['owner'], 'owner', []],
  ])(
    '%s',
    (_caseName, staffMembershipId, administratorMembershipIds, actorMembershipId, expected) => {
      expect(
        selectNotificationRecipients({
          staffMembershipId,
          administratorMembershipIds,
          actorMembershipId,
        }),
      ).toEqual(expected);
    },
  );
});

describe('planBookingNotices', () => {
  const base = {
    clientMembershipId: 'client',
    staffMembershipId: 'staff',
    administratorMembershipIds: ['owner', 'admin'],
  };

  it('tells the team, not the client, when the client books', () => {
    const notices = planBookingNotices({ ...base, change: 'created', actorMembershipId: 'client' });

    expect(notices).toEqual([
      { recipientMembershipId: 'staff', kind: 'booking_created' },
      { recipientMembershipId: 'owner', kind: 'booking_created' },
      { recipientMembershipId: 'admin', kind: 'booking_created' },
    ]);
  });

  it('tells the client and the rest of the team when the administration cancels', () => {
    const notices = planBookingNotices({
      ...base,
      change: 'cancelled',
      actorMembershipId: 'owner',
    });

    expect(notices).toEqual([
      { recipientMembershipId: 'client', kind: 'booking_cancelled_by_team' },
      { recipientMembershipId: 'staff', kind: 'booking_cancelled' },
      { recipientMembershipId: 'admin', kind: 'booking_cancelled' },
    ]);
  });

  it('tells the team, not the client, when the client moves their own appointment', () => {
    const notices = planBookingNotices({
      ...base,
      change: 'rescheduled',
      actorMembershipId: 'client',
    });

    expect(notices.map(({ kind }) => kind)).toEqual([
      'booking_rescheduled',
      'booking_rescheduled',
      'booking_rescheduled',
    ]);
  });

  it('tells the client when the team moves their appointment', () => {
    const notices = planBookingNotices({
      ...base,
      change: 'rescheduled',
      actorMembershipId: 'owner',
    });

    expect(notices[0]).toEqual({
      recipientMembershipId: 'client',
      kind: 'booking_rescheduled_by_team',
    });
  });

  it('does not tell the instructor about what they did themselves', () => {
    const notices = planBookingNotices({ ...base, change: 'created', actorMembershipId: 'staff' });

    expect(notices.map(({ recipientMembershipId }) => recipientMembershipId)).toEqual([
      'client',
      'owner',
      'admin',
    ]);
    expect(notices[0]?.kind).toBe('booking_created_by_team');
  });
});
