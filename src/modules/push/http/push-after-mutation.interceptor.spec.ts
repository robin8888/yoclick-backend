import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type PushDispatcher } from '../application/push-dispatcher';
import { PushAfterMutationInterceptor } from './push-after-mutation.interceptor';

const ACTOR: ActorContext = {
  userId: 'user-1',
  centerId: 'center-1',
  membershipId: 'membership-1',
  role: 'admin',
  permissions: [],
};

function buildContext(request: { method: string; actor?: ActorContext }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PushAfterMutationInterceptor', () => {
  const flushCenter = jest.fn().mockResolvedValue(undefined);
  const interceptor = new PushAfterMutationInterceptor({
    flushCenter,
  } as unknown as PushDispatcher);
  const handler: CallHandler = { handle: () => of({ ok: true }) };

  beforeEach(() => {
    flushCenter.mockClear();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'sends the pending push notices after a successful %s of a center member',
    async (method) => {
      const response = await firstValueFrom(
        interceptor.intercept(buildContext({ method, actor: ACTOR }), handler),
      );

      expect(response).toEqual({ ok: true });
      expect(flushCenter).toHaveBeenCalledWith(ACTOR);
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS'])('does nothing after a read-only %s', async (method) => {
    await firstValueFrom(interceptor.intercept(buildContext({ method, actor: ACTOR }), handler));

    expect(flushCenter).not.toHaveBeenCalled();
  });

  it('does nothing outside a center (no actor)', async () => {
    await firstValueFrom(interceptor.intercept(buildContext({ method: 'POST' }), handler));

    expect(flushCenter).not.toHaveBeenCalled();
  });
});
