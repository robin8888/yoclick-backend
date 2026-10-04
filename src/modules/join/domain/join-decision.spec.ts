import { decideJoin, type JoinDecision, type JoinFacts } from './join-decision';

const OPEN_CENTER: JoinFacts['center'] = {
  status: 'active',
  isListed: false,
  joinCode: 'NORTE7',
  maxClients: null,
};
const FIVE_CLIENT_CENTER: JoinFacts['center'] = { ...OPEN_CENTER, maxClients: 5 };

function factsWith(overrides: Partial<JoinFacts>): JoinFacts {
  return {
    center: OPEN_CENTER,
    presentedJoinCode: 'NORTE7',
    existingMembership: null,
    activeClientCount: 0,
    ...overrides,
  };
}

const CASES: readonly [string, JoinFacts, JoinDecision][] = [
  ['a private center with its code', factsWith({}), 'create_membership'],
  [
    'a private center without a code',
    factsWith({ presentedJoinCode: null }),
    'center_not_joinable',
  ],
  [
    'a private center with a wrong code',
    factsWith({ presentedJoinCode: 'OTRO12' }),
    'center_not_joinable',
  ],
  [
    'a listed center without a code',
    factsWith({ center: { ...OPEN_CENTER, isListed: true }, presentedJoinCode: null }),
    'create_membership',
  ],
  [
    'a suspended center even with its code',
    factsWith({ center: { ...OPEN_CENTER, status: 'suspended' } }),
    'center_not_joinable',
  ],
  [
    'someone who left',
    factsWith({ existingMembership: { role: 'client', status: 'left' } }),
    'reactivate_membership',
  ],
  [
    'someone already active',
    factsWith({ existingMembership: { role: 'client', status: 'active' } }),
    'already_member',
  ],
  [
    'someone blocked',
    factsWith({ existingMembership: { role: 'client', status: 'blocked' } }),
    'membership_blocked',
  ],
  [
    'a full center',
    factsWith({ center: FIVE_CLIENT_CENTER, activeClientCount: 5 }),
    'client_limit_reached',
  ],
  [
    'a center one place short of full',
    factsWith({ center: FIVE_CLIENT_CENTER, activeClientCount: 4 }),
    'create_membership',
  ],
  [
    'a full center for someone already a member',
    factsWith({
      center: FIVE_CLIENT_CENTER,
      activeClientCount: 5,
      existingMembership: { role: 'client', status: 'active' },
    }),
    'already_member',
  ],
  [
    'a full center for someone rejoining',
    factsWith({
      center: FIVE_CLIENT_CENTER,
      activeClientCount: 5,
      existingMembership: { role: 'client', status: 'left' },
    }),
    'client_limit_reached',
  ],
];

describe('decideJoin', () => {
  it.each(CASES)('decides for %s', (_description, facts, expectedDecision) => {
    expect(decideJoin(facts)).toBe(expectedDecision);
  });
});
