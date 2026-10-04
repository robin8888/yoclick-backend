import { createHash } from 'node:crypto';
import { type PinoLogger } from 'nestjs-pino';
import { PwnedPasswordsChecker } from './pwned-passwords.checker';

const PASSWORD = 'correct horse battery staple';
// SHA-1 es el formato del servicio que se simula, no un uso de seguridad.
// eslint-disable-next-line sonarjs/hashing
const SHA1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();
const HASH_PREFIX = SHA1.slice(0, 5);
const HASH_SUFFIX = SHA1.slice(5);

function buildChecker(): { checker: PwnedPasswordsChecker; warn: jest.Mock } {
  const warn = jest.fn();
  return { checker: new PwnedPasswordsChecker({ warn } as unknown as PinoLogger), warn };
}

function respondWith(body: string, ok = true): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    text: () => Promise.resolve(body),
  } as Response);
}

describe('PwnedPasswordsChecker', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends only the first 5 characters of the SHA-1, never the password or the full hash', async () => {
    const fetchSpy = respondWith('');
    const { checker } = buildChecker();

    await checker.isBreached(PASSWORD);

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${HASH_PREFIX}`);
    expect(url).not.toContain(HASH_SUFFIX);
    expect(url).not.toContain(encodeURIComponent(PASSWORD));
  });

  it('asks for padded responses so an observer cannot infer the match from the size', async () => {
    const fetchSpy = respondWith('');
    const { checker } = buildChecker();

    await checker.isBreached(PASSWORD);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['add-padding']).toBe('true');
  });

  it('reports a breach when the suffix is in the returned list with a positive count', async () => {
    respondWith(`0123456789ABCDEF0123456789ABCDEF012:3\r\n${HASH_SUFFIX}:48211\r\nFFFF:2`);
    const { checker } = buildChecker();

    expect(await checker.isBreached(PASSWORD)).toBe(true);
  });

  it('is not breached when the suffix is absent', async () => {
    respondWith('0123456789ABCDEF0123456789ABCDEF012:3\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:9');
    const { checker } = buildChecker();

    expect(await checker.isBreached(PASSWORD)).toBe(false);
  });

  it('ignores padding entries, which carry a count of 0', async () => {
    respondWith(`${HASH_SUFFIX}:0`);
    const { checker } = buildChecker();

    expect(await checker.isBreached(PASSWORD)).toBe(false);
  });

  it('fails open when the service is unreachable: registration must not depend on a third party', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const { checker, warn } = buildChecker();

    expect(await checker.isBreached(PASSWORD)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('fails open on an error status', async () => {
    respondWith('Service unavailable', false);
    const { checker } = buildChecker();

    expect(await checker.isBreached(PASSWORD)).toBe(false);
  });

  it('never logs the password or its hash when it fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
    const { checker, warn } = buildChecker();

    await checker.isBreached(PASSWORD);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(HASH_SUFFIX);
  });
});
