import { hash as hashWithArgon2 } from 'argon2';
import { PasswordHasher } from './password-hasher';

const PASSWORD = 'correct horse battery staple';

describe('PasswordHasher', () => {
  const passwordHasher = new PasswordHasher();

  it('produces an argon2id hash with at least the memory and time cost SEC-43 asks for', async () => {
    const passwordHash = await passwordHasher.hash(PASSWORD);

    // El orden de los parámetros en la cadena PHC lo decide la librería: se comprueba cada uno por separado.
    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    const [, , , parameters] = passwordHash.split('$');
    const memoryKibibytes = Number(/m=(\d+)/.exec(parameters ?? '')?.[1]);
    const timeCost = Number(/t=(\d+)/.exec(parameters ?? '')?.[1]);
    expect(memoryKibibytes).toBeGreaterThanOrEqual(19_456);
    expect(timeCost).toBeGreaterThanOrEqual(2);
  });

  it('never contains the password', async () => {
    expect(await passwordHasher.hash(PASSWORD)).not.toContain(PASSWORD);
  });

  it('salts every hash: the same password gives a different hash each time', async () => {
    const first = await passwordHasher.hash(PASSWORD);
    const second = await passwordHasher.hash(PASSWORD);

    expect(first).not.toBe(second);
  });

  it('verifies the right password', async () => {
    const passwordHash = await passwordHasher.hash(PASSWORD);

    expect(await passwordHasher.verify(passwordHash, PASSWORD)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await passwordHasher.hash(PASSWORD);

    expect(await passwordHasher.verify(passwordHash, `${PASSWORD}!`)).toBe(false);
  });

  it('answers false, not an exception, for a corrupt or empty stored hash', async () => {
    expect(await passwordHasher.verify('not-a-hash', PASSWORD)).toBe(false);
    expect(await passwordHasher.verify('', PASSWORD)).toBe(false);
  });

  it('does not need rehash when the hash already uses the current parameters', async () => {
    expect(passwordHasher.needsRehash(await passwordHasher.hash(PASSWORD))).toBe(false);
  });

  it('asks for a rehash when the stored hash is weaker than today policy', async () => {
    const weakHash = await hashWithArgon2(PASSWORD, { memoryCost: 1024, timeCost: 1 });

    expect(passwordHasher.needsRehash(weakHash)).toBe(true);
  });

  it('spends comparable time on a login for an unknown email, so timing reveals nothing', async () => {
    const startedAt = performance.now();
    await passwordHasher.spendTimeLikeAVerification(PASSWORD);
    const elapsedMilliseconds = performance.now() - startedAt;

    // Una verificación real tarda decenas de milisegundos; un atajo vacío tardaría casi cero.
    expect(elapsedMilliseconds).toBeGreaterThan(5);
  });
});
