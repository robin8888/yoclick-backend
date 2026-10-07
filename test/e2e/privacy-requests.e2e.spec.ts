import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { ReauthenticationChecker } from '../../src/modules/auth/application/reauthentication.checker';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type PushSendResult,
} from '../../src/modules/push/application/ports/push-sender';
import { DomainError } from '../../src/shared/errors/domain-error';
import { HTTP_STATUS } from '../../src/shared/errors/http-status';
import { type TenantTransactionClient } from '../../src/shared/database/tenant-prisma.service';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const CORRECT_PASSWORD = 'correct-password';
const TOKEN_OWNER = 'ExponentPushToken[owner-device-0001]';
const TOKEN_ANA = 'ExponentPushToken[ana-device-0001]';

/** Las cuentas de prueba no tienen contraseña real: este doble acepta una conocida. */
const fakeReauthenticationChecker = {
  assertPasswordIsCorrect: (_userId: string, password: string) => {
    if (password !== CORRECT_PASSWORD) {
      return Promise.reject(new DomainError('REAUTHENTICATION_FAILED', HTTP_STATUS.forbidden));
    }
    return Promise.resolve({});
  },
};

class RecordingPushSender implements PushSender {
  readonly sent: PushMessage[] = [];

  send(messages: readonly PushMessage[]): Promise<PushSendResult> {
    this.sent.push(...messages);
    return Promise.resolve({ invalidTokens: [] });
  }

  tokensFor(kind: string): string[] {
    return this.sent.filter(({ data: payload }) => payload['kind'] === kind).map(({ to }) => to);
  }
}

interface RequestBody {
  id: string;
  clientMembershipId: string;
  clientName: string;
  kind: string;
  status: string;
  message: string | null;
  dueAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

describe('privacy requests (GDPR rights)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let center: CreatedTestCenter;
  let owner: string;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let bruno: { userId: string; membershipId: string };
  const pushSender = new RecordingPushSender();

  const url = (path: string): string => `/v1/centers/${center.centerId}${path}`;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, userId: string, body?: object) =>
    world.call(method, url(path), userId, { centerId: center.centerId, ...(body && { body }) });
  const ownerActor = () =>
    ({
      userId: owner,
      centerId: center.centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;
  const inCenter = <TResult>(work: (client: TenantTransactionClient) => Promise<TResult>) =>
    world.tenantPrismaService.runInTenantContext(ownerActor(), work);

  const askFor = (userId: string, kind: string, message?: string) =>
    call('POST', '/privacy-requests', userId, { kind, ...(message && { message }) });

  async function openRequestOf(userId: string, kind = 'access'): Promise<RequestBody> {
    const response = await askFor(userId, kind);
    expect(response.statusCode).toBe(201);
    return response.json<RequestBody>();
  }

  async function noticeKindsOf(userId: string): Promise<string[]> {
    const response = await call('GET', '/notifications', userId);
    return response
      .json<{ notifications: { kind: string }[] }>()
      .notifications.map(({ kind }) => kind);
  }

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [
        { token: PUSH_SENDER, value: pushSender },
        { token: ReauthenticationChecker, value: fakeReauthenticationChecker },
      ],
    });
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    pushSender.sent.length = 0;
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
    ana = await world.addMember(center.centerId, 'ana', 'client');
    bruno = await world.addMember(center.centerId, 'bruno', 'client');
    await world.call('PUT', '/v1/me/push-token', owner, {
      body: { token: TOKEN_OWNER, platform: 'ios' },
    });
    await world.call('PUT', '/v1/me/push-token', ana.userId, {
      body: { token: TOKEN_ANA, platform: 'ios' },
    });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('asking', () => {
    it('opens a request with a deadline of one month and tells the administration', async () => {
      const before = Date.now();

      const response = await askFor(ana.userId, 'access', 'Quiero ver mis datos.');

      expect(response.statusCode).toBe(201);
      const body = response.json<RequestBody>();
      expect(body).toMatchObject({
        kind: 'access',
        status: 'open',
        message: 'Quiero ver mis datos.',
        clientMembershipId: ana.membershipId,
        resolvedAt: null,
      });
      const monthLater = new Date(before);
      monthLater.setUTCMonth(monthLater.getUTCMonth() + 1);
      const daysFromExpected = Math.abs(Date.parse(body.dueAt) - monthLater.getTime()) / 86_400_000;
      expect(daysFromExpected).toBeLessThanOrEqual(3);
      expect(await noticeKindsOf(owner)).toContain('privacy_request_received');
      expect(pushSender.tokensFor('privacy_request_received')).toEqual([TOKEN_OWNER]);
    });

    it('drops a blank message', async () => {
      const response = await call('POST', '/privacy-requests', ana.userId, {
        kind: 'erasure',
        message: '   ',
      });

      expect(response.json<RequestBody>().message).toBeNull();
    });

    it('does not accept a second open request of the same right, but allows another right', async () => {
      await openRequestOf(ana.userId, 'access');

      const repeated = await askFor(ana.userId, 'access');
      const other = await askFor(ana.userId, 'erasure');

      expect(repeated.statusCode).toBe(409);
      expect(repeated.json<{ code: string }>().code).toBe('PRIVACY_REQUEST_ALREADY_OPEN');
      expect(other.statusCode).toBe(201);
    });

    it('lets two different people ask for the same right', async () => {
      await openRequestOf(ana.userId);

      expect((await askFor(bruno.userId, 'access')).statusCode).toBe(201);
    });

    it('refuses an unknown right and extra fields', async () => {
      expect((await askFor(ana.userId, 'sell-my-data')).statusCode).toBe(400);
      const withExtra = await call('POST', '/privacy-requests', ana.userId, {
        kind: 'access',
        status: 'completed',
      });
      expect(withExtra.statusCode).toBe(400);
    });

    it('is for clients only', async () => {
      expect((await askFor(staff.userId, 'access')).statusCode).toBe(403);
      expect((await askFor(owner, 'access')).statusCode).toBe(403);
    });

    it('shows each client only their own requests', async () => {
      await openRequestOf(ana.userId);
      await openRequestOf(bruno.userId, 'erasure');

      const mine = await call('GET', '/privacy-requests/mine', ana.userId);

      const requests = mine.json<{ requests: RequestBody[] }>().requests;
      expect(requests.map(({ kind }) => kind)).toEqual(['access']);
    });
  });

  describe('answering', () => {
    it('lists the open requests first, the one due earlier on top, and then the resolved ones', async () => {
      const first = await openRequestOf(ana.userId, 'access');
      await openRequestOf(bruno.userId, 'erasure');
      await openRequestOf(bruno.userId, 'access');
      await call('POST', `/privacy-requests/${first.id}/resolve`, owner, { outcome: 'completed' });

      const response = await call('GET', '/privacy-requests', owner);

      const requests = response.json<{ requests: RequestBody[] }>().requests;
      expect(requests.map(({ status }) => status)).toEqual(['open', 'open', 'completed']);
      const openDueDates = requests.slice(0, 2).map(({ dueAt }) => Date.parse(dueAt));
      expect(openDueDates[0]).toBeLessThanOrEqual(openDueDates[1] ?? 0);
      expect(requests[0]?.clientName).toBeTruthy();
    });

    it('is not for the team or the clients', async () => {
      await openRequestOf(ana.userId);

      expect((await call('GET', '/privacy-requests', staff.userId)).statusCode).toBe(403);
      expect((await call('GET', '/privacy-requests', ana.userId)).statusCode).toBe(403);
    });

    it('completes a request, tells the person and leaves a record in the activity log', async () => {
      const request = await openRequestOf(ana.userId);
      pushSender.sent.length = 0;

      const response = await call('POST', `/privacy-requests/${request.id}/resolve`, owner, {
        outcome: 'completed',
        note: 'Te hemos enviado tus datos.',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<RequestBody>()).toMatchObject({
        status: 'completed',
        resolutionNote: 'Te hemos enviado tus datos.',
      });
      expect(await noticeKindsOf(ana.userId)).toContain('privacy_request_resolved');
      expect(pushSender.tokensFor('privacy_request_resolved')).toEqual([TOKEN_ANA]);
      const activity = await call('GET', '/activity', owner);
      expect(JSON.stringify(activity.json())).toContain('privacy_request_resolved');
    });

    it('asks to say why when a request is rejected', async () => {
      const request = await openRequestOf(ana.userId);

      const withoutReason = await call('POST', `/privacy-requests/${request.id}/resolve`, owner, {
        outcome: 'rejected',
      });
      const withReason = await call('POST', `/privacy-requests/${request.id}/resolve`, owner, {
        outcome: 'rejected',
        note: 'No hay datos tuyos que rectificar.',
      });

      expect(withoutReason.statusCode).toBe(400);
      expect(withReason.json<RequestBody>()).toMatchObject({ status: 'rejected' });
    });

    it('cannot be resolved twice', async () => {
      const request = await openRequestOf(ana.userId);
      await call('POST', `/privacy-requests/${request.id}/resolve`, owner, {
        outcome: 'completed',
      });

      const again = await call('POST', `/privacy-requests/${request.id}/resolve`, owner, {
        outcome: 'completed',
      });

      expect(again.statusCode).toBe(409);
      expect(again.json<{ code: string }>().code).toBe('PRIVACY_REQUEST_CLOSED');
    });

    it('lets the person ask again once the previous request is closed', async () => {
      const request = await openRequestOf(ana.userId);
      await call('POST', `/privacy-requests/${request.id}/resolve`, owner, {
        outcome: 'completed',
      });

      expect((await askFor(ana.userId, 'access')).statusCode).toBe(201);
    });

    it('does not find a request of another center', async () => {
      const request = await openRequestOf(ana.userId);
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro Centro');

      const response = await world.call(
        'POST',
        `/v1/centers/${otherCenter.centerId}/privacy-requests/${request.id}/resolve`,
        otherOwner,
        { centerId: otherCenter.centerId, body: { outcome: 'completed' } },
      );

      expect(response.statusCode).toBe(404);
    });

    it('keeps the request as a record: the application cannot delete it', async () => {
      const request = await openRequestOf(ana.userId);

      await expect(
        inCenter((client) => client.privacyRequest.delete({ where: { id: request.id } })),
      ).rejects.toThrow();
    });
  });

  describe('exporting what the center keeps of a person (right of access)', () => {
    const exportOf = (membershipId: string, password: string, userId = owner) =>
      call('POST', `/clients/${membershipId}/data-export`, userId, { password });

    it('asks for the password of the administrator who exports', async () => {
      const response = await exportOf(ana.membershipId, 'wrong-password');

      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('REAUTHENTICATION_FAILED');
    });

    it('gives the person, the membership, the requests and leaves a record', async () => {
      await openRequestOf(ana.userId);

      const response = await exportOf(ana.membershipId, CORRECT_PASSWORD);

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        person: { fullName: string; email: string };
        membership: { status: string };
        bookings: unknown[];
        privacyRequests: { kind: string }[];
      }>();
      expect(body.person.email).toContain('ana');
      expect(body.membership.status).toBe('active');
      expect(body.bookings).toEqual([]);
      expect(body.privacyRequests.map(({ kind }) => kind)).toEqual(['access']);
      expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
      const activity = await call('GET', '/activity', owner);
      expect(JSON.stringify(activity.json())).toContain('client_data_exported');
    });

    it('is only for the administration, and only for clients of this center', async () => {
      expect((await exportOf(ana.membershipId, CORRECT_PASSWORD, staff.userId)).statusCode).toBe(
        403,
      );
      expect((await exportOf(ana.membershipId, CORRECT_PASSWORD, ana.userId)).statusCode).toBe(403);
      expect((await exportOf(randomUUID(), CORRECT_PASSWORD)).statusCode).toBe(404);
      expect((await exportOf(staff.membershipId, CORRECT_PASSWORD)).statusCode).toBe(404);
    });
  });
});
