import { DomainError } from '../../../shared/errors/domain-error';
import { type CloseCenterUseCase } from '../../billing/application/close-center.use-case';
import { type OwnedCenterRef } from '../../billing/application/ports/billing.repository';
import { type ReauthenticationChecker } from '../../auth/application/reauthentication.checker';
import { type SessionRepository } from '../../auth/application/ports/session.repository';
import { type PhotoFileKeeper } from '../../photos/application/photo-file-keeper';
import { DeleteMyAccountUseCase } from './delete-my-account.use-case';
import { type AccountErasureRepository } from './ports/account-erasure.repository';

const USER_ID = 'user-1';
const PASSWORD = 'Nosnibor88';
const NORTE: OwnedCenterRef = { centerId: 'center-norte', name: 'Norte' };
const SUR: OwnedCenterRef = { centerId: 'center-sur', name: 'Sur' };

/** Apunta en qué orden ocurre cada paso: lo importante es que el centro se cierra antes de borrar la cuenta. */
function buildHarness(ownedCenters: OwnedCenterRef[]) {
  const steps: string[] = [];
  const closedCenterIds: string[] = [];
  let isClosingFailing = false;

  const reauthentication = {
    assertPasswordIsCorrect: (_userId: string, password: string) => {
      steps.push('reauthenticate');
      return password === PASSWORD
        ? Promise.resolve()
        : Promise.reject(new DomainError('REAUTHENTICATION_FAILED', 403));
    },
  };
  const erasure: AccountErasureRepository = {
    anonymize: () => {
      steps.push('anonymize');
      return Promise.resolve(null);
    },
  };
  const sessions = {
    revokeAllOfUser: () => {
      steps.push('revoke-sessions');
      return Promise.resolve();
    },
  };
  const photos = { discard: () => Promise.resolve() };
  const closer = {
    listCentersSolelyOwnedBy: () => Promise.resolve(ownedCenters),
    execute: ({ centerId }: { centerId: string }) => {
      steps.push(`close:${centerId}`);
      if (isClosingFailing) return Promise.reject(new Error('Stripe is down'));
      closedCenterIds.push(centerId);
      return Promise.resolve();
    },
  };

  const useCase = new DeleteMyAccountUseCase(
    reauthentication as unknown as ReauthenticationChecker,
    erasure,
    sessions as unknown as SessionRepository,
    photos as unknown as PhotoFileKeeper,
    closer as unknown as CloseCenterUseCase,
  );
  return {
    useCase,
    steps,
    closedCenterIds,
    makeClosingFail: () => {
      isClosingFailing = true;
    },
  };
}

describe('DeleteMyAccountUseCase', () => {
  it('deletes the account of someone who owns no center, closing nothing', async () => {
    const { useCase, steps, closedCenterIds } = buildHarness([]);

    await useCase.execute({ userId: USER_ID, password: PASSWORD, closeOwnedCenters: false });

    expect(steps).toEqual(['reauthenticate', 'revoke-sessions', 'anonymize']);
    expect(closedCenterIds).toEqual([]);
  });

  it('refuses the sole owner of a center who has not confirmed closing it, and deletes nothing', async () => {
    const { useCase, steps, closedCenterIds } = buildHarness([NORTE]);

    await expect(
      useCase.execute({ userId: USER_ID, password: PASSWORD, closeOwnedCenters: false }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_OWNS_CENTER' });

    expect(steps).toEqual(['reauthenticate']);
    expect(closedCenterIds).toEqual([]);
  });

  it('closes every center they solely own and then deletes the account, in that order', async () => {
    const { useCase, steps, closedCenterIds } = buildHarness([NORTE, SUR]);

    await useCase.execute({ userId: USER_ID, password: PASSWORD, closeOwnedCenters: true });

    expect(closedCenterIds).toEqual(['center-norte', 'center-sur']);
    expect(steps).toEqual([
      'reauthenticate',
      'close:center-norte',
      'close:center-sur',
      'revoke-sessions',
      'anonymize',
    ]);
  });

  it('does not close or refuse anything when the center has another owner (it is not in the sole-owned list)', async () => {
    const { useCase, steps, closedCenterIds } = buildHarness([]);

    await useCase.execute({ userId: USER_ID, password: PASSWORD, closeOwnedCenters: true });

    expect(closedCenterIds).toEqual([]);
    expect(steps).toContain('anonymize');
  });

  it('keeps the account when closing a center fails, so the person can try again', async () => {
    const { useCase, steps, makeClosingFail } = buildHarness([NORTE]);
    makeClosingFail();

    await expect(
      useCase.execute({ userId: USER_ID, password: PASSWORD, closeOwnedCenters: true }),
    ).rejects.toThrow('Stripe is down');

    expect(steps).toEqual(['reauthenticate', 'close:center-norte']);
  });

  it('asks for the password first: a wrong one closes and deletes nothing', async () => {
    const { useCase, steps } = buildHarness([NORTE]);

    await expect(
      useCase.execute({ userId: USER_ID, password: 'wrong', closeOwnedCenters: true }),
    ).rejects.toMatchObject({ code: 'REAUTHENTICATION_FAILED' });

    expect(steps).toEqual(['reauthenticate']);
  });
});
