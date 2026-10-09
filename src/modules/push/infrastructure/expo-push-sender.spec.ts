import { ExpoPushSender } from './expo-push-sender';

describe('ExpoPushSender', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  afterEach(() => {
    fetchMock.mockReset();
  });

  function answerWith(tickets: unknown[]): void {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: tickets }), { status: 200 }));
  }

  it('sends each notice to the high priority channel the app creates, with sound', async () => {
    answerWith([{ status: 'ok' }]);

    await new ExpoPushSender(undefined).send([
      { to: 'ExponentPushToken[a]', title: 'Hola', body: 'Abre la aplicación', data: {} },
    ]);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toEqual([
      expect.objectContaining({
        to: 'ExponentPushToken[a]',
        sound: 'default',
        priority: 'high',
        channelId: 'avisos',
      }),
    ]);
  });

  it('does not ask for an access token unless one is configured', async () => {
    answerWith([{ status: 'ok' }]);

    await new ExpoPushSender(undefined).send([
      { to: 'ExponentPushToken[a]', title: 'Hola', body: 'x', data: {} },
    ]);

    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)['Authorization'],
    ).toBeUndefined();
  });

  it('reports the devices that no longer exist so they can be removed', async () => {
    answerWith([{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }]);

    const result = await new ExpoPushSender('token').send([
      { to: 'ExponentPushToken[alive]', title: 'Hola', body: 'x', data: {} },
      { to: 'ExponentPushToken[dead]', title: 'Hola', body: 'x', data: {} },
    ]);

    expect(result.invalidTokens).toEqual(['ExponentPushToken[dead]']);
  });
});
