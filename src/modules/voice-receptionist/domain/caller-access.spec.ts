import { canGuestBookService, determineCallerAudience, doesCenterUsePasses } from './caller-access';

describe('doesCenterUsePasses / determineCallerAudience', () => {
  it.each([
    { disabledModules: [], usesPasses: true, audience: 'student' },
    { disabledModules: ['rooms'], usesPasses: true, audience: 'student' },
    { disabledModules: ['passes'], usesPasses: false, audience: 'client' },
    { disabledModules: ['waitlist', 'passes'], usesPasses: false, audience: 'client' },
  ])(
    'with $disabledModules the center uses passes: $usesPasses (audience $audience)',
    ({ disabledModules, usesPasses, audience }) => {
      expect(doesCenterUsePasses(disabledModules)).toBe(usesPasses);
      expect(determineCallerAudience(disabledModules)).toBe(audience);
    },
  );
});

describe('canGuestBookService', () => {
  it.each([
    { name: 'pass center, trial service', disabledModules: [], allowsTrial: true, expected: true },
    {
      name: 'pass center, ordinary service',
      disabledModules: [],
      allowsTrial: false,
      expected: false,
    },
    {
      name: 'no-pass center, ordinary service',
      disabledModules: ['passes'],
      allowsTrial: false,
      expected: true,
    },
    {
      name: 'no-pass center, trial service',
      disabledModules: ['passes'],
      allowsTrial: true,
      expected: true,
    },
  ])('is $expected for a $name', ({ disabledModules, allowsTrial, expected }) => {
    expect(canGuestBookService({ disabledModules, serviceAllowsTrialBookings: allowsTrial })).toBe(
      expected,
    );
  });
});
