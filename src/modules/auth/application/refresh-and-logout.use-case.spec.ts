import { InMemorySessionRepository } from '../../../../test/support/auth-fakes';
import { type AccessTokenService } from '../../../shared/auth/access-token.service';
import { generateRefreshToken, hashRefreshToken } from '../domain/refresh-token';
import { LogoutUseCase } from './logout.use-case';
import { RefreshSessionUseCase } from './refresh-session.use-case';
import { SessionIssuer } from './session-issuer';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const DAY_MS = 86_400_000;

function buildScenario() {
  const sessions = new InMemorySessionRepository();
  const accessTokens = {
    issue: (userId: string) =>
      Promise.resolve({ token: `access-for-${userId}`, expiresAt: new Date(Date.now() + 600_000) }),
  } as unknown as AccessTokenService;
  const issuer = new SessionIssuer(sessions, accessTokens);
  return {
    sessions,
    issuer,
    refresh: new RefreshSessionUseCase(sessions, issuer),
    logout: new LogoutUseCase(sessions),
  };
}

async function startSession(scenario: ReturnType<typeof buildScenario>, userId = USER_ID) {
  return scenario.issuer.startSession({ userId, deviceName: 'test device', isMfaVerified: false });
}

async function captureError(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }
  return undefined;
}

const SESSION_INVALID = { code: 'SESSION_INVALID', httpStatus: 401 };

describe('RefreshSessionUseCase', () => {
  it('exchanges a refresh token for a new access token and a new refresh token', async () => {
    const scenario = buildScenario();
    const first = await startSession(scenario);

    const second = await scenario.refresh.execute({
      refreshToken: first.refreshToken,
      deviceName: null,
    });

    expect(second.accessToken).toBe(`access-for-${USER_ID}`);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('rotates inside the same family and revokes the token it replaced', async () => {
    const scenario = buildScenario();
    const first = await startSession(scenario);

    await scenario.refresh.execute({ refreshToken: first.refreshToken, deviceName: null });

    const [oldToken, newToken] = scenario.sessions.tokens;
    expect(oldToken?.familyId).toBe(newToken?.familyId);
    expect(oldToken?.revokedAtMutable).toBeInstanceOf(Date);
    expect(oldToken?.replacedById).toBe(newToken?.id);
    expect(newToken?.revokedAtMutable).toBeNull();
  });

  it('renews the lifetime of the session on every use', async () => {
    const scenario = buildScenario();
    const first = await startSession(scenario);

    const second = await scenario.refresh.execute({
      refreshToken: first.refreshToken,
      deviceName: null,
    });

    expect(second.refreshTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(
      first.refreshTokenExpiresAt.getTime(),
    );
  });

  it('rejects an unknown token with 401 SESSION_INVALID', async () => {
    const scenario = buildScenario();

    const error = await captureError(
      scenario.refresh.execute({ refreshToken: generateRefreshToken().token, deviceName: null }),
    );

    expect(error).toMatchObject(SESSION_INVALID);
  });

  it('rejects an expired token', async () => {
    const scenario = buildScenario();
    const first = await startSession(scenario);
    const stored = scenario.sessions.tokens[0];
    if (stored) (stored as { expiresAt: Date }).expiresAt = new Date(Date.now() - DAY_MS);

    const error = await captureError(
      scenario.refresh.execute({ refreshToken: first.refreshToken, deviceName: null }),
    );

    expect(error).toMatchObject(SESSION_INVALID);
  });

  describe('reuse of an already-rotated token means it was stolen (SEC-45)', () => {
    it('rejects the replayed token', async () => {
      const scenario = buildScenario();
      const first = await startSession(scenario);
      await scenario.refresh.execute({ refreshToken: first.refreshToken, deviceName: null });

      const error = await captureError(
        scenario.refresh.execute({ refreshToken: first.refreshToken, deviceName: null }),
      );

      expect(error).toMatchObject(SESSION_INVALID);
    });

    it('revokes the whole family, including the newest token the thief never saw', async () => {
      const scenario = buildScenario();
      const first = await startSession(scenario);
      const second = await scenario.refresh.execute({
        refreshToken: first.refreshToken,
        deviceName: null,
      });
      await captureError(
        scenario.refresh.execute({ refreshToken: first.refreshToken, deviceName: null }),
      );

      const withLegitimateNewestToken = await captureError(
        scenario.refresh.execute({ refreshToken: second.refreshToken, deviceName: null }),
      );

      expect(withLegitimateNewestToken).toMatchObject(SESSION_INVALID);
      expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(0);
    });

    it('leaves the person other devices signed in', async () => {
      const scenario = buildScenario();
      const stolen = await startSession(scenario);
      const otherDevice = await startSession(scenario);
      await scenario.refresh.execute({ refreshToken: stolen.refreshToken, deviceName: null });
      await captureError(
        scenario.refresh.execute({ refreshToken: stolen.refreshToken, deviceName: null }),
      );

      const stillWorks = await scenario.refresh.execute({
        refreshToken: otherDevice.refreshToken,
        deviceName: null,
      });

      expect(stillWorks.accessToken).toBe(`access-for-${USER_ID}`);
    });

    it('lets only one of two simultaneous refreshes win, and treats the loser as reuse', async () => {
      const scenario = buildScenario();
      const first = await startSession(scenario);

      const outcomes = await Promise.allSettled([
        scenario.refresh.execute({ refreshToken: first.refreshToken, deviceName: null }),
        scenario.refresh.execute({ refreshToken: first.refreshToken, deviceName: null }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(0);
    });
  });
});

describe('LogoutUseCase', () => {
  it('revokes the family of the device that signs out', async () => {
    const scenario = buildScenario();
    const session = await startSession(scenario);

    await scenario.logout.execute({
      userId: USER_ID,
      refreshToken: session.refreshToken,
      everywhere: false,
    });

    expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(0);
  });

  it('leaves the other devices signed in', async () => {
    const scenario = buildScenario();
    const phone = await startSession(scenario);
    await startSession(scenario);

    await scenario.logout.execute({
      userId: USER_ID,
      refreshToken: phone.refreshToken,
      everywhere: false,
    });

    expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(1);
  });

  it('signs out of every device when asked', async () => {
    const scenario = buildScenario();
    await startSession(scenario);
    await startSession(scenario);

    await scenario.logout.execute({ userId: USER_ID, refreshToken: null, everywhere: true });

    expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(0);
  });

  it('never revokes the session of someone else, even with a valid token of theirs', async () => {
    const scenario = buildScenario();
    const victim = await startSession(scenario, OTHER_USER_ID);

    await scenario.logout.execute({
      userId: USER_ID,
      refreshToken: victim.refreshToken,
      everywhere: false,
    });

    expect(scenario.sessions.activeTokensOf(OTHER_USER_ID)).toBe(1);
  });

  it('succeeds quietly for an unknown token, so it cannot be used to probe tokens', async () => {
    const scenario = buildScenario();

    await expect(
      scenario.logout.execute({
        userId: USER_ID,
        refreshToken: generateRefreshToken().token,
        everywhere: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('does nothing, without error, when no token is given and not signing out everywhere', async () => {
    const scenario = buildScenario();
    await startSession(scenario);

    await expect(
      scenario.logout.execute({ userId: USER_ID, refreshToken: null, everywhere: false }),
    ).resolves.toBeUndefined();
    expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(1);
  });

  it('can revoke by the stored hash only, which is all the database holds', () => {
    expect(hashRefreshToken('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
