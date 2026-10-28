import { isOverClientLimit } from './client-limit';

describe('isOverClientLimit', () => {
  it.each([
    { name: 'a plan without limit', activeClientCount: 5000, maxClients: null, expected: false },
    {
      name: 'fewer clients than the limit',
      activeClientCount: 149,
      maxClients: 150,
      expected: false,
    },
    { name: 'exactly the limit', activeClientCount: 150, maxClients: 150, expected: false },
    { name: 'one client over the limit', activeClientCount: 151, maxClients: 150, expected: true },
    { name: 'far over the limit', activeClientCount: 212, maxClients: 150, expected: true },
    { name: 'no clients and no room', activeClientCount: 0, maxClients: 0, expected: false },
    { name: 'a client and no room', activeClientCount: 1, maxClients: 0, expected: true },
  ])('is $expected with $name', ({ activeClientCount, maxClients, expected }) => {
    expect(isOverClientLimit({ activeClientCount, maxClients })).toBe(expected);
  });
});
