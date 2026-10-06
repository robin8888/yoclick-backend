import { selectNotificationRecipients } from './notification-rules';

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
