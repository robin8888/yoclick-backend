import {
  canInviteRole,
  decideTeamChange,
  higherRole,
  type TeamChangeAttempt,
  type TeamChangeDecision,
  type TeamRoleName,
} from './team-rules';

describe('canInviteRole', () => {
  it.each<[TeamRoleName, TeamRoleName, boolean]>([
    ['owner', 'admin', true],
    ['owner', 'staff', true],
    ['owner', 'client', true],
    ['admin', 'admin', true],
    ['admin', 'staff', true],
    ['staff', 'client', true],
    ['staff', 'staff', false],
    ['staff', 'admin', false],
    ['client', 'client', false],
    ['owner', 'owner', false],
    ['admin', 'owner', false],
  ])('%s inviting %s → %s', (inviter, invited, expected) => {
    expect(canInviteRole(inviter, invited)).toBe(expected);
  });
});

describe('higherRole', () => {
  it('keeps the higher of the two roles, so accepting never demotes', () => {
    expect(higherRole('admin', 'staff')).toBe('admin');
    expect(higherRole('client', 'staff')).toBe('staff');
    expect(higherRole('owner', 'client')).toBe('owner');
  });
});

const OWNER = { userId: 'owner-1', role: 'owner' } as const;
const ADMIN = { userId: 'admin-1', role: 'admin' } as const;
const OTHER_ADMIN = { userId: 'admin-2', role: 'admin' } as const;
const STAFF = { userId: 'staff-1', role: 'staff' } as const;
const CLIENT = { userId: 'client-1', role: 'client' } as const;

function attempt(overrides: Partial<TeamChangeAttempt>): TeamChangeAttempt {
  return {
    actor: OWNER,
    target: STAFF,
    isChangingRole: false,
    isChangingStatus: false,
    newRole: undefined,
    ...overrides,
  };
}

describe('decideTeamChange', () => {
  it.each<[string, TeamChangeAttempt, TeamChangeDecision]>([
    ['the owner edits a staff member', attempt({}), 'allowed'],
    [
      'the owner promotes staff to admin',
      attempt({ isChangingRole: true, newRole: 'admin' }),
      'allowed',
    ],
    ['the owner blocks an admin', attempt({ target: ADMIN, isChangingStatus: true }), 'allowed'],
    ['an admin edits staff', attempt({ actor: ADMIN }), 'allowed'],
    [
      'an admin promotes staff to admin',
      attempt({ actor: ADMIN, isChangingRole: true, newRole: 'admin' }),
      'forbidden',
    ],
    ['an admin edits another admin', attempt({ actor: ADMIN, target: OTHER_ADMIN }), 'forbidden'],
    ['an admin edits their own title', attempt({ actor: ADMIN, target: ADMIN }), 'allowed'],
    [
      'an admin changes their own role',
      attempt({ actor: ADMIN, target: ADMIN, isChangingRole: true, newRole: 'staff' }),
      'forbidden',
    ],
    ['anyone touches the owner', attempt({ actor: ADMIN, target: OWNER }), 'forbidden'],
    [
      'the owner touches themselves as owner',
      attempt({ target: OWNER, isChangingRole: true }),
      'forbidden',
    ],
    ['staff tries to manage the team', attempt({ actor: STAFF, target: STAFF }), 'forbidden'],
    ['the target is a plain client', attempt({ target: CLIENT }), 'not_a_team_member'],
    [
      'the owner blocks themselves',
      attempt({ target: { ...OWNER }, isChangingStatus: true }),
      'forbidden',
    ],
  ])('%s → %s', (_description, change, expected) => {
    expect(decideTeamChange(change)).toBe(expected);
  });
});
