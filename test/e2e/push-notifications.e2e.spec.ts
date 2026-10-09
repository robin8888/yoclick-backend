import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type PushSendResult,
} from '../../src/modules/push/application/ports/push-sender';
import { addDaysToLocalDate, toLocalDate } from '../../src/shared/time/zoned-time';
import {
  BookingWorld,
  firstSlotAtLeast,
  localDateOf,
  type CreatedTestCenter,
  type TestSlot,
} from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MIN_HOURS_AHEAD = 24;
const TOKEN_OWNER = 'ExponentPushToken[owner-device-0001]';
const TOKEN_STAFF = 'ExponentPushToken[staff-device-0001]';
const TOKEN_ANA = 'ExponentPushToken[ana-device-0001]';

const compareText = (first: string, second: string): number => first.localeCompare(second);

class RecordingPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  invalidTokens: string[] = [];
  shouldFail = false;

  send(messages: readonly PushMessage[]): Promise<PushSendResult> {
    if (this.shouldFail) return Promise.reject(new Error('Expo is down'));
    this.sent.push(...messages);
    return Promise.resolve({ invalidTokens: this.invalidTokens });
  }

  tokensFor(kind: string): string[] {
    return this.sent.filter(({ data: payload }) => payload['kind'] === kind).map(({ to }) => to);
  }
}

describe('push notifications', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let center: CreatedTestCenter;
  let owner: string;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let serviceId: string;
  const pushSender = new RecordingPushSender();

  const registerDevice = (userId: string, token: string) =>
    world.call('PUT', '/v1/me/push-token', userId, { body: { token, platform: 'ios' } });
  const agendaUrl = (path: string): string => `/v1/centers/${center.centerId}/agenda${path}`;

  async function firstFutureSlot(): Promise<TestSlot> {
    return firstSlotAtLeast(
      await world.fetchSlots(ana.userId, center.centerId, serviceId),
      MIN_HOURS_AHEAD,
    );
  }

  async function twoFutureSlots(): Promise<[TestSlot, TestSlot]> {
    const slots = (await world.fetchSlots(ana.userId, center.centerId, serviceId)).filter(
      ({ startsAt }) => Date.parse(startsAt) - Date.now() >= MIN_HOURS_AHEAD * 3_600_000,
    );
    return [slots[0] as TestSlot, slots[1] as TestSlot];
  }

  async function anaBooks(slot: TestSlot): Promise<string> {
    const response = await world.book(ana.userId, center.centerId, {
      serviceId,
      startsAt: slot.startsAt,
    });
    return response.json<{ id: string }>().id;
  }

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [{ token: PUSH_SENDER, value: pushSender }],
    });
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    pushSender.sent.length = 0;
    pushSender.invalidTokens = [];
    pushSender.shouldFail = false;
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    await world.openAllWeek(owner, center.centerId);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
    ana = await world.addMember(center.centerId, 'ana', 'client');
    serviceId = (
      await world.createService(owner, center.centerId, {
        name: 'Sesión personal',
        durationMinutes: 60,
        minNoticeMinutes: 0,
        staffMembershipIds: [staff.membershipId],
      })
    ).id;
    await registerDevice(owner, TOKEN_OWNER);
    await registerDevice(staff.userId, TOKEN_STAFF);
    await registerDevice(ana.userId, TOKEN_ANA);
  });

  afterAll(async () => {
    await application.close();
  });

  describe('registering a phone', () => {
    it('rejects a token that is not an Expo push token', async () => {
      const response = await world.call('PUT', '/v1/me/push-token', ana.userId, {
        body: { token: 'not-a-token', platform: 'ios' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('moves the phone to the new person when somebody else logs in on it', async () => {
      await registerDevice(staff.userId, TOKEN_ANA);

      const slot = await firstFutureSlot();
      await anaBooks(slot);

      expect(pushSender.tokensFor('booking_created')).toContain(TOKEN_ANA);
    });

    it('stops sending to a phone that was unregistered', async () => {
      await world.call('POST', '/v1/me/push-token/unregister', staff.userId, {
        body: { token: TOKEN_STAFF },
      });

      await anaBooks(await firstFutureSlot());

      expect(pushSender.tokensFor('booking_created')).toEqual([TOKEN_OWNER]);
    });
  });

  describe('when a client books or cancels', () => {
    it('tells the instructor and the administration, but not the client who did it', async () => {
      await anaBooks(await firstFutureSlot());

      expect(pushSender.tokensFor('booking_created').sort(compareText)).toEqual(
        [TOKEN_OWNER, TOKEN_STAFF].sort(compareText),
      );
    });

    it('says nothing personal in the text of the push', async () => {
      await anaBooks(await firstFutureSlot());

      for (const message of pushSender.sent) {
        expect(`${message.title} ${message.body}`).not.toMatch(/ana|sesión|\d{1,2}:\d{2}/i);
        expect(Object.values(message.data).join(' ')).not.toMatch(/ana|sesión/i);
      }
    });

    it('tells the team when the client cancels', async () => {
      const slot = await firstFutureSlot();
      const bookingId = await anaBooks(slot);
      pushSender.sent.length = 0;

      await world.call(
        'POST',
        `/v1/centers/${center.centerId}/bookings/${bookingId}/cancel`,
        ana.userId,
        {
          centerId: center.centerId,
        },
      );

      expect(pushSender.tokensFor('booking_cancelled').sort(compareText)).toEqual(
        [TOKEN_OWNER, TOKEN_STAFF].sort(compareText),
      );
    });
  });

  describe('when the center or the instructor changes an appointment', () => {
    it('tells the client when the administration cancels their appointment', async () => {
      const bookingId = await anaBooks(await firstFutureSlot());
      pushSender.sent.length = 0;

      const response = await world.call('POST', agendaUrl(`/bookings/${bookingId}/cancel`), owner, {
        centerId: center.centerId,
      });

      expect(response.statusCode).toBe(200);
      expect(pushSender.tokensFor('booking_cancelled_by_team')).toEqual([TOKEN_ANA]);
      expect(pushSender.tokensFor('booking_cancelled')).toEqual([TOKEN_STAFF]);
    });

    it('tells the client when the instructor puts an appointment for them', async () => {
      const slot = await firstFutureSlot();

      const response = await world.call('POST', agendaUrl('/bookings'), staff.userId, {
        centerId: center.centerId,
        body: { serviceId, startsAt: slot.startsAt, clientMembershipId: ana.membershipId },
      });

      expect(response.statusCode).toBe(201);
      expect(pushSender.tokensFor('booking_created_by_team')).toEqual([TOKEN_ANA]);
      expect(pushSender.tokensFor('booking_created')).toEqual([TOKEN_OWNER]);
    });

    it('tells the client when the instructor moves their appointment', async () => {
      const [current, target] = await twoFutureSlots();
      const bookingId = await anaBooks(current);
      pushSender.sent.length = 0;

      const response = await world.call(
        'POST',
        agendaUrl(`/bookings/${bookingId}/reschedule`),
        staff.userId,
        { centerId: center.centerId, body: { startsAt: target.startsAt } },
      );

      expect(response.statusCode).toBe(200);
      expect(response.json<{ id: string; startsAt: string }>()).toMatchObject({
        id: bookingId,
        startsAt: target.startsAt,
      });
      expect(pushSender.tokensFor('booking_rescheduled_by_team')).toEqual([TOKEN_ANA]);
      expect(pushSender.tokensFor('booking_rescheduled')).toEqual([TOKEN_OWNER]);
    });

    it('lets the administration move an appointment with less notice than the client needs', async () => {
      const [, target] = await twoFutureSlots();
      const soon = firstSlotAtLeast(
        await world.fetchSlots(ana.userId, center.centerId, serviceId),
        2,
        20,
      );
      const bookingId = await anaBooks(soon);

      const response = await world.call(
        'POST',
        agendaUrl(`/bookings/${bookingId}/reschedule`),
        owner,
        {
          centerId: center.centerId,
          body: { startsAt: target.startsAt },
        },
      );

      expect(response.statusCode).toBe(200);
    });

    it('does not tell anybody when the appointment keeps its hour', async () => {
      const [current] = await twoFutureSlots();
      const bookingId = await anaBooks(current);
      pushSender.sent.length = 0;

      const response = await world.call(
        'POST',
        agendaUrl(`/bookings/${bookingId}/reschedule`),
        owner,
        {
          centerId: center.centerId,
          body: { startsAt: current.startsAt, staffMembershipId: staff.membershipId },
        },
      );

      expect(response.statusCode).toBe(200);
      expect(pushSender.sent).toEqual([]);
    });

    it('does not let an instructor move an appointment of somebody else', async () => {
      const [current, target] = await twoFutureSlots();
      const bookingId = await anaBooks(current);
      const other = await world.addMember(center.centerId, 'other-mover', 'staff');

      const response = await world.call(
        'POST',
        agendaUrl(`/bookings/${bookingId}/reschedule`),
        other.userId,
        { centerId: center.centerId, body: { startsAt: target.startsAt } },
      );

      expect(response.statusCode).toBe(404);
    });

    it('does not let a client use the agenda to move an appointment', async () => {
      const [current, target] = await twoFutureSlots();
      const bookingId = await anaBooks(current);

      const response = await world.call(
        'POST',
        agendaUrl(`/bookings/${bookingId}/reschedule`),
        ana.userId,
        {
          centerId: center.centerId,
          body: { startsAt: target.startsAt },
        },
      );

      expect(response.statusCode).toBe(403);
    });

    it('answers 409 BOOKING_NOT_RESCHEDULABLE when the appointment was cancelled', async () => {
      const [current, target] = await twoFutureSlots();
      const bookingId = await anaBooks(current);
      await world.call('POST', agendaUrl(`/bookings/${bookingId}/cancel`), owner, {
        centerId: center.centerId,
      });

      const response = await world.call(
        'POST',
        agendaUrl(`/bookings/${bookingId}/reschedule`),
        owner,
        {
          centerId: center.centerId,
          body: { startsAt: target.startsAt },
        },
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'BOOKING_NOT_RESCHEDULABLE' });
    });

    it('does not let an instructor cancel an appointment of somebody else', async () => {
      const bookingId = await anaBooks(await firstFutureSlot());
      const other = await world.addMember(center.centerId, 'other', 'staff');

      const response = await world.call(
        'POST',
        agendaUrl(`/bookings/${bookingId}/cancel`),
        other.userId,
        {
          centerId: center.centerId,
        },
      );

      expect(response.statusCode).toBe(404);
    });

    it('answers 409 when the appointment was already cancelled', async () => {
      const bookingId = await anaBooks(await firstFutureSlot());
      await world.call('POST', agendaUrl(`/bookings/${bookingId}/cancel`), owner, {
        centerId: center.centerId,
      });

      const second = await world.call('POST', agendaUrl(`/bookings/${bookingId}/cancel`), owner, {
        centerId: center.centerId,
      });

      expect(second.statusCode).toBe(409);
    });
  });

  describe('when an instructor is away', () => {
    it('tells the administration and every client who had an appointment those days', async () => {
      const slot = await firstFutureSlot();
      await anaBooks(slot);
      pushSender.sent.length = 0;
      const date = localDateOf(slot.startsAt);

      const response = await world.call(
        'POST',
        `/v1/centers/${center.centerId}/team/${staff.membershipId}/absences`,
        staff.userId,
        { centerId: center.centerId, body: { startsOn: date, endsOn: date, reason: 'training' } },
      );

      expect(response.statusCode).toBe(201);
      expect(pushSender.tokensFor('absence_added')).toEqual([TOKEN_OWNER]);
      expect(pushSender.tokensFor('booking_affected_by_absence')).toEqual([TOKEN_ANA]);
    });

    it('tells the instructor when the administration adds the absence', async () => {
      const today = toLocalDate(new Date(), 'Europe/Madrid');

      await world.call(
        'POST',
        `/v1/centers/${center.centerId}/team/${staff.membershipId}/absences`,
        owner,
        {
          centerId: center.centerId,
          body: { startsOn: today, endsOn: addDaysToLocalDate(today, 1), reason: 'vacation' },
        },
      );

      expect(pushSender.tokensFor('absence_added')).toEqual([TOKEN_STAFF]);
    });
  });

  describe('when the push service has problems', () => {
    it('does not fail the booking and keeps the push pending for the next send', async () => {
      pushSender.shouldFail = true;
      const slot = await firstFutureSlot();

      const response = await world.book(ana.userId, center.centerId, {
        serviceId,
        startsAt: slot.startsAt,
      });
      expect(response.statusCode).toBe(201);
      expect(pushSender.sent).toHaveLength(0);

      pushSender.shouldFail = false;
      const other = await world.fetchSlots(ana.userId, center.centerId, serviceId);
      await world.book(ana.userId, center.centerId, {
        serviceId,
        startsAt: firstSlotAtLeast(other, MIN_HOURS_AHEAD + 48).startsAt,
      });

      expect(pushSender.tokensFor('booking_created').length).toBeGreaterThanOrEqual(4);
    });

    it('forgets the phones the service says do not exist anymore', async () => {
      pushSender.invalidTokens = [TOKEN_STAFF];
      await anaBooks(await firstFutureSlot());
      pushSender.sent.length = 0;
      pushSender.invalidTokens = [];

      const other = await world.fetchSlots(ana.userId, center.centerId, serviceId);
      await world.book(ana.userId, center.centerId, {
        serviceId,
        startsAt: firstSlotAtLeast(other, MIN_HOURS_AHEAD + 48).startsAt,
      });

      expect(pushSender.tokensFor('booking_created')).toEqual([TOKEN_OWNER]);
    });
  });
});
