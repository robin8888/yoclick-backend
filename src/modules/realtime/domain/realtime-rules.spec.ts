import { authMessageSchema, buildConnectionKey } from './realtime-rules';

const CENTER_ID = '0191d6a0-0000-7000-8000-000000000001';

describe('authMessageSchema', () => {
  it('accepts the identification message', () => {
    const parsed = authMessageSchema.safeParse({
      type: 'auth',
      accessToken: 'a.b.c',
      centerId: CENTER_ID,
    });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['an unknown type', { type: 'hello', accessToken: 'a', centerId: CENTER_ID }],
    ['no token', { type: 'auth', accessToken: '', centerId: CENTER_ID }],
    ['a center that is not an id', { type: 'auth', accessToken: 'a', centerId: 'x' }],
    ['extra fields', { type: 'auth', accessToken: 'a', centerId: CENTER_ID, admin: true }],
    [
      'a token that is too long',
      { type: 'auth', accessToken: 'a'.repeat(5000), centerId: CENTER_ID },
    ],
  ])('rejects %s', (_name, message) => {
    expect(authMessageSchema.safeParse(message).success).toBe(false);
  });
});

describe('buildConnectionKey', () => {
  it('separates the same membership id in different centers', () => {
    expect(buildConnectionKey({ centerId: 'a', membershipId: 'm' })).not.toBe(
      buildConnectionKey({ centerId: 'b', membershipId: 'm' }),
    );
  });
});
