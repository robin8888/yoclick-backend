import { type AccessTokenService } from '../../../shared/auth/access-token.service';
import { DomainError } from '../../../shared/errors/domain-error';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { CheckInClientUseCase, IssueCheckInCodeUseCase } from './check-in.use-cases';
import { type CheckInOutcome, type CheckInRepository } from './ports/check-in.repository';

const NOW = new Date('2026-10-05T10:00:00Z');
const CENTER_ID = 'center-1';
const CLIENT_MEMBERSHIP_ID = 'membership-client';
const STAFF: ActorContext = {
  userId: 'user-staff',
  centerId: CENTER_ID,
  membershipId: 'membership-staff',
  role: 'staff',
  permissions: [],
};
const QR_CONTENT = 'yoclick:checkin:aaa.bbb.ccc';

interface TokenDoubles {
  readonly tokens: AccessTokenService;
  readonly issueCheckinToken: jest.Mock;
  readonly verifyCheckinToken: jest.Mock;
}

function buildTokens(
  claims = { membershipId: CLIENT_MEMBERSHIP_ID, centerId: CENTER_ID },
): TokenDoubles {
  const issueCheckinToken = jest
    .fn()
    .mockResolvedValue({ token: 'aaa.bbb.ccc', expiresAt: new Date('2026-10-05T10:05:00Z') });
  const verifyCheckinToken = jest.fn().mockResolvedValue(claims);
  return {
    tokens: { issueCheckinToken, verifyCheckinToken } as unknown as AccessTokenService,
    issueCheckinToken,
    verifyCheckinToken,
  };
}

interface RepositoryDouble {
  readonly repository: CheckInRepository;
  readonly checkInClient: jest.Mock;
}

function buildRepository(outcome: CheckInOutcome): RepositoryDouble {
  const checkInClient = jest.fn().mockResolvedValue(outcome);
  return { repository: { checkInClient }, checkInClient };
}

async function errorOf(work: Promise<unknown>): Promise<DomainError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Expected a DomainError');
}

describe('IssueCheckInCodeUseCase', () => {
  it('wraps the signed token in the QR format with the membership and center of the actor', async () => {
    const { tokens, issueCheckinToken } = buildTokens();
    const actor: ActorContext = {
      ...STAFF,
      membershipId: CLIENT_MEMBERSHIP_ID,
      role: 'client',
    };

    const code = await new IssueCheckInCodeUseCase(tokens).execute(actor);

    expect(code.qrContent).toBe(QR_CONTENT);
    expect(issueCheckinToken).toHaveBeenCalledWith({
      membershipId: CLIENT_MEMBERSHIP_ID,
      centerId: CENTER_ID,
    });
  });
});

describe('CheckInClientUseCase', () => {
  const request = { actor: STAFF, qrContent: QR_CONTENT, now: NOW };

  it('rejects content that is not a check-in QR without verifying anything', async () => {
    const { tokens, verifyCheckinToken } = buildTokens();
    const { repository } = buildRepository({ kind: 'no_booking' });
    const useCase = new CheckInClientUseCase(tokens, repository);

    const error = await errorOf(useCase.execute({ ...request, qrContent: 'https://x.es' }));

    expect(error.code).toBe('CHECKIN_CODE_INVALID');
    expect(verifyCheckinToken).not.toHaveBeenCalled();
  });

  it('rejects a code issued for another center as if it were fake', async () => {
    const { tokens } = buildTokens({
      membershipId: CLIENT_MEMBERSHIP_ID,
      centerId: 'other-center',
    });
    const { repository, checkInClient } = buildRepository({ kind: 'no_booking' });

    const error = await errorOf(new CheckInClientUseCase(tokens, repository).execute(request));

    expect(error.code).toBe('CHECKIN_CODE_INVALID');
    expect(checkInClient).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_client', 'CHECKIN_CODE_INVALID'],
    ['no_booking', 'CHECKIN_NO_BOOKING'],
  ] as const)('maps the repository outcome "%s" to %s', async (kind, expectedCode) => {
    const useCase = new CheckInClientUseCase(
      buildTokens().tokens,
      buildRepository({ kind }).repository,
    );

    expect((await errorOf(useCase.execute(request))).code).toBe(expectedCode);
  });

  it('returns the check-in when the repository registers it', async () => {
    const outcome = {
      kind: 'checked_in',
      booking: {},
      clientFullName: 'Lucía Torres',
      checkedInAt: NOW,
    } as unknown as CheckInOutcome;
    const useCase = new CheckInClientUseCase(
      buildTokens().tokens,
      buildRepository(outcome).repository,
    );

    await expect(useCase.execute(request)).resolves.toBe(outcome);
  });
});
