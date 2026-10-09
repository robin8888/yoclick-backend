import { BunnyFileStorage } from './bunny-file-storage';

const SETTINGS = {
  zone: 'yoclick-files',
  apiKey: 'api-key',
  storageHost: 'storage.bunnycdn.com',
  cdnHostname: 'yoclick-files-cdn.b-cdn.net',
  tokenKey: 'token-key',
};

describe('BunnyFileStorage.signDownload', () => {
  it('gives a plain link when the pull zone does not ask for a token', () => {
    const storage = new BunnyFileStorage({ ...SETTINGS, isTokenAuthEnabled: false });

    expect(storage.signDownload('center/file.pdf').url).toBe(
      'https://yoclick-files-cdn.b-cdn.net/center/file.pdf',
    );
  });

  it('gives a link with token and expiry when the pull zone asks for one', () => {
    const storage = new BunnyFileStorage({ ...SETTINGS, isTokenAuthEnabled: true });

    expect(storage.signDownload('center/file.pdf').url).toMatch(
      /^https:\/\/yoclick-files-cdn\.b-cdn\.net\/center\/file\.pdf\?token=[\w-]+&expires=\d+$/,
    );
  });

  it('makes the link expire in the future', () => {
    const storage = new BunnyFileStorage({ ...SETTINGS, isTokenAuthEnabled: false });

    expect(storage.signDownload('center/file.pdf').expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('BunnyFileStorage requests', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('puts the file in the zone with the access key', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    const storage = new BunnyFileStorage({ ...SETTINGS, isTokenAuthEnabled: false });

    await storage.putFile({ key: 'center/file.pdf', bytes: Buffer.from('%PDF-') });

    const [address, init] = fetchMock.mock.calls[0] ?? [];
    expect(address).toBe('https://storage.bunnycdn.com/yoclick-files/center/file.pdf');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({ AccessKey: 'api-key' });
  });

  it('fails without leaking the answer of the service', async () => {
    fetchMock.mockResolvedValue(new Response('account details', { status: 401 }));
    const storage = new BunnyFileStorage({ ...SETTINGS, isTokenAuthEnabled: false });

    await expect(
      storage.putFile({ key: 'center/file.pdf', bytes: Buffer.from('%PDF-') }),
    ).rejects.toThrow('Bunny Storage answered 401 to PUT center/file.pdf');
  });

  it('takes a file that is already gone as deleted', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const storage = new BunnyFileStorage({ ...SETTINGS, isTokenAuthEnabled: false });

    await expect(storage.deleteFile('center/file.pdf')).resolves.toBeUndefined();
  });
});
