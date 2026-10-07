import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { RecordingEmailSender } from '../support/auth-fakes';
import { BookingWorld } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const IMPORTED_EMAIL = 'ana@import.test';
const NEW_PASSWORD = 'a brand new passphrase 2026';

describe('an imported person claims their account', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let centerId: string;
  const emails = new RecordingEmailSender();

  const post = (url: string, payload: object) =>
    application.inject({ method: 'POST', url, payload });
  const login = (password: string) => post('/v1/auth/login', { email: IMPORTED_EMAIL, password });

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [{ token: EMAIL_SENDER, value: emails }],
    });
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    emails.sent.length = 0;
    ownerUserId = await world.fixtures.createUser('owner');
    centerId = (await world.createCenter(ownerUserId)).centerId;
    await world.call('POST', `/v1/centers/${centerId}/clients/import`, ownerUserId, {
      centerId,
      body: { rows: [{ fullName: 'Ana Pérez', email: IMPORTED_EMAIL }] },
    });
  });

  afterAll(async () => {
    await application.close();
  });

  it('cannot log in until they set a password, whatever they type', async () => {
    expect((await login('!')).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(401);
  });

  it('gets a code by email, sets a password with it and logs in', async () => {
    const forgot = await post('/v1/auth/password/forgot', { email: IMPORTED_EMAIL });
    const code = emails.lastCodeSentTo(IMPORTED_EMAIL) ?? '';

    const reset = await post('/v1/auth/password/reset', {
      email: IMPORTED_EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });

    expect(forgot.statusCode).toBe(202);
    expect(reset.statusCode).toBe(200);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('is a client of the center that imported them as soon as they can log in', async () => {
    await post('/v1/auth/password/forgot', { email: IMPORTED_EMAIL });
    const code = emails.lastCodeSentTo(IMPORTED_EMAIL) ?? '';
    await post('/v1/auth/password/reset', {
      email: IMPORTED_EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });
    const session = (await login(NEW_PASSWORD)).json<{ accessToken: string }>();

    const memberships = await application.inject({
      method: 'GET',
      url: '/v1/me/memberships',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(memberships.json<{ memberships: { centerId: string; role: string }[] }>()).toMatchObject(
      {
        memberships: [{ centerId, role: 'client' }],
      },
    );
  });
});
