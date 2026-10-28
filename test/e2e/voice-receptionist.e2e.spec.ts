import { randomUUID } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { VoiceTranscriptSweeper } from '../../src/modules/voice-receptionist/application/voice-transcript-sweeper';
import {
  FAKE_WEBHOOK_SECRET,
  FAKE_WEBHOOK_SECRET_HEADER,
} from '../../src/modules/voice-receptionist/infrastructure/fake-voice-agent-provider';
import {
  BookingWorld,
  firstSlotAtLeast,
  type CreatedTestCenter,
  type TestService,
} from '../support/booking-world';
import { grantPlatformRoleAsOwner, resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const FIRST_BRIDGE_NUMBER = '+34910000001';
const SECOND_BRIDGE_NUMBER = '+34910000002';
const CALLER_NUMBER = '+34600111222';

interface Person {
  userId: string;
  membershipId: string;
}

interface ToolBody {
  toolCallId: string;
  result: Record<string, unknown>;
  transferToNumber?: string;
}

interface CallOptions {
  readonly callId?: string;
  readonly toolCallId?: string;
  readonly called?: string;
  readonly caller?: string;
}

describe('voice receptionist (contestador IA de citas)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let adminUserId: string;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let staff: Person;
  let ana: Person;
  let luis: Person;
  let haircut: TestService;
  let trialClass: TestService;
  let callCounter = 0;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;
  const newCallId = (): string => {
    callCounter += 1;
    return `call-${String(callCounter)}`;
  };

  async function callTool(
    path: string,
    args: Record<string, unknown>,
    options: CallOptions = {},
  ): Promise<ToolBody> {
    const response = await world.call('POST', `/v1/webhooks/voice/${path}`, undefined, {
      headers: { [FAKE_WEBHOOK_SECRET_HEADER]: FAKE_WEBHOOK_SECRET },
      body: {
        providerCallId: options.callId ?? 'call-default',
        toolCallId: options.toolCallId ?? randomUUID(),
        calledNumber: options.called ?? FIRST_BRIDGE_NUMBER,
        callerNumber: options.caller ?? CALLER_NUMBER,
        arguments: args,
      },
    });
    if (response.statusCode !== 200) throw new Error(`Tool ${path} failed: ${response.body}`);
    return response.json<ToolBody>();
  }

  async function studentCodeOf(person: Person): Promise<string> {
    const response = await world.call('GET', url('/me/student-code'), person.userId, { centerId });
    return response.json<{ code: string }>().code;
  }

  async function updateCenter(changes: Record<string, unknown>): Promise<void> {
    await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.center.update({ where: { id: centerId }, data: changes }),
    );
  }

  async function provisionAndEnable(): Promise<void> {
    const provisioned = await world.call(
      'PUT',
      `/v1/platform/centers/${centerId}/voice-receptionist`,
      adminUserId,
      { body: { bridgeNumber: FIRST_BRIDGE_NUMBER, provider: 'fake' } },
    );
    expect(provisioned.statusCode).toBe(204);
    const enabled = await world.call('POST', url('/voice-receptionist/enable'), ownerUserId, {
      centerId,
    });
    expect(enabled.statusCode).toBe(204);
  }

  async function freeSlotFor(service: TestService): Promise<string> {
    const slots = await world.fetchSlots(ana.userId, centerId, service.id);
    return firstSlotAtLeast(slots, 3).startsAt;
  }

  const bookingsOf = async (person: Person): Promise<{ id: string }[]> =>
    (
      await world.call('GET', url('/bookings/mine?scope=upcoming'), person.userId, { centerId })
    ).json<{ bookings: { id: string }[] }>().bookings;

  async function identify(callId: string, person: Person): Promise<ToolBody> {
    return callTool('identify-caller', { studentCode: await studentCodeOf(person) }, { callId });
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    adminUserId = await world.fixtures.createUser('platform-admin');
    await grantPlatformRoleAsOwner(adminUserId, 'admin');
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    centerId = center.centerId;
    await world.openAllWeek(ownerUserId, centerId);
    staff = await world.addMember(centerId, 'staff', 'staff');
    ana = await world.addMember(centerId, 'ana', 'client');
    luis = await world.addMember(centerId, 'luis', 'client');
    haircut = await world.createService(ownerUserId, centerId, {
      name: 'Sesión personal',
      durationMinutes: 60,
      minNoticeMinutes: 0,
    });
    trialClass = await world.createService(ownerUserId, centerId, {
      name: 'Clase de prueba',
      durationMinutes: 60,
      minNoticeMinutes: 0,
    });
    await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.service.update({ where: { id: trialClass.id }, data: { allowsTrialBookings: true } }),
    );
    await provisionAndEnable();
  });

  afterAll(async () => {
    await application.close();
  });

  describe('the webhook door', () => {
    const body = (): object => ({
      providerCallId: 'c',
      toolCallId: 't',
      calledNumber: FIRST_BRIDGE_NUMBER,
      callerNumber: CALLER_NUMBER,
      arguments: {},
    });

    it('rejects a wrong or missing secret before reading anything', async () => {
      const wrong = await world.call('POST', '/v1/webhooks/voice/identify-caller', undefined, {
        headers: { [FAKE_WEBHOOK_SECRET_HEADER]: 'not-the-secret' },
        body: body(),
      });
      const missing = await world.call('POST', '/v1/webhooks/voice/identify-caller', undefined, {
        body: body(),
      });

      expect(wrong.statusCode).toBe(401);
      expect(missing.statusCode).toBe(401);
    });

    it('rejects a body that is not a well-formed order', async () => {
      const response = await world.call('POST', '/v1/webhooks/voice/identify-caller', undefined, {
        headers: { [FAKE_WEBHOOK_SECRET_HEADER]: FAKE_WEBHOOK_SECRET },
        body: { providerCallId: 'c' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('tells the bot to hand the call over when the number belongs to nobody', async () => {
      const reply = await callTool('identify-caller', {}, { called: '+34910999999' });

      expect(reply.result).toMatchObject({
        ok: false,
        reason: 'line_not_available',
        shouldTransfer: true,
      });
    });

    it('refuses extra fields the language model invented, like a center or membership id', async () => {
      const reply = await callTool('bookings/cancel', {
        bookingId: randomUUID(),
        centerId: randomUUID(),
        membershipId: ana.membershipId,
      });

      expect(reply.result).toMatchObject({ ok: false, reason: 'invalid_arguments' });
    });
  });

  describe('switch and subscription', () => {
    it('does nothing while the center has switched it off, and again after switching it off', async () => {
      const off = await world.call('POST', url('/voice-receptionist/disable'), ownerUserId, {
        centerId,
      });
      expect(off.statusCode).toBe(204);

      const reply = await callTool('available-sessions', {});

      expect(reply.result).toMatchObject({ ok: false, reason: 'service_not_enabled' });
    });

    it('cannot be switched on without a subscription or without a bridge number', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const other = await world.createCenter(otherOwner, 'Otro Centro');

      const response = await world.call(
        'POST',
        `/v1/centers/${other.centerId}/voice-receptionist/enable`,
        otherOwner,
        { centerId: other.centerId },
      );

      expect(response.statusCode).toBe(402);
      expect(response.json<{ code: string }>().code).toBe('VOICE_ADDON_NOT_CONTRACTED');
    });

    it('resolves the center by the number that was called, never by what the caller says', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const other = await world.createCenter(otherOwner, 'Otro Centro');
      await world.call(
        'PUT',
        `/v1/platform/centers/${other.centerId}/voice-receptionist`,
        adminUserId,
        { body: { bridgeNumber: SECOND_BRIDGE_NUMBER, provider: 'fake' } },
      );
      await world.call(
        'POST',
        `/v1/centers/${other.centerId}/voice-receptionist/enable`,
        otherOwner,
        {
          centerId: other.centerId,
        },
      );
      const code = await studentCodeOf(ana);

      const sameCenter = await callTool('identify-caller', { studentCode: code });
      const otherCenter = await callTool(
        'identify-caller',
        { studentCode: code },
        { called: SECOND_BRIDGE_NUMBER, callId: 'call-other' },
      );

      expect(sameCenter.result).toMatchObject({ ok: true, identified: true, firstName: 'ana' });
      expect(otherCenter.result).toMatchObject({ ok: false, reason: 'code_not_found' });
    });

    it('keeps the owner of one center out of the voice panel of another', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const other = await world.createCenter(otherOwner, 'Otro Centro');

      const response = await world.call('GET', url('/voice-receptionist'), otherOwner, {
        centerId: other.centerId,
      });

      expect(response.statusCode).not.toBe(200);
    });
  });

  describe('student code', () => {
    it('is six digits, created once and always the same', async () => {
      const first = await studentCodeOf(ana);
      const second = await studentCodeOf(ana);

      expect(first).toMatch(/^\d{6}$/);
      expect(second).toBe(first);
      expect(await studentCodeOf(luis)).not.toBe(first);
    });

    it('is only for clients', async () => {
      const response = await world.call('GET', url('/me/student-code'), ownerUserId, { centerId });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('identifying the caller', () => {
    it('keeps the identity inside the call: another call starts as a stranger', async () => {
      const callId = newCallId();
      await identify(callId, ana);

      const sameCall = await callTool('caller-bookings', {}, { callId });
      const otherCall = await callTool('caller-bookings', {}, { callId: newCallId() });

      expect(sameCall.result).toMatchObject({ ok: true, bookings: [] });
      expect(otherCall.result).toMatchObject({ ok: false, reason: 'not_identified' });
    });

    it('hands the call to a person after three wrong codes, even if the fourth is right', async () => {
      const callId = newCallId();
      const correctCode = await studentCodeOf(ana);
      const wrongCode = correctCode === '000000' ? '111111' : '000000';

      const first = await callTool('identify-caller', { studentCode: wrongCode }, { callId });
      const second = await callTool('identify-caller', { studentCode: wrongCode }, { callId });
      const third = await callTool('identify-caller', { studentCode: wrongCode }, { callId });
      const afterwards = await callTool(
        'identify-caller',
        { studentCode: correctCode },
        { callId },
      );

      expect(first.result).toMatchObject({ reason: 'code_not_found', remainingAttempts: 2 });
      expect(second.result).toMatchObject({ reason: 'code_not_found', remainingAttempts: 1 });
      expect(third.result).toMatchObject({ reason: 'too_many_attempts', shouldTransfer: true });
      expect(afterwards.result).toMatchObject({
        reason: 'too_many_attempts',
        shouldTransfer: true,
      });
    });

    it('says only the first name and never other personal data', async () => {
      const reply = await identify(newCallId(), ana);

      expect(new Set(Object.keys(reply.result))).toEqual(
        new Set([
          'audience',
          'capabilities',
          'firstName',
          'identified',
          'isGuest',
          'ok',
          'phoneMatchesCaller',
          'remainingPassSessions',
        ]),
      );
      expect(JSON.stringify(reply)).not.toContain('example.test');
    });
  });

  describe('booking for a student', () => {
    it('books with the code, exactly as the app would', async () => {
      const callId = newCallId();
      await identify(callId, ana);
      const startsAt = await freeSlotFor(haircut);

      const reply = await callTool('bookings', { serviceId: haircut.id, startsAt }, { callId });

      expect(reply.result).toMatchObject({ ok: true });
      expect(await bookingsOf(ana)).toHaveLength(1);
    });

    it('applies the pass rule of the app: no pass, no booking when the center sells one', async () => {
      await world.call('POST', url('/rates'), ownerUserId, {
        centerId,
        body: {
          name: 'Bono 10',
          sessionsCount: 10,
          validDays: 30,
          priceCents: 5000,
          serviceIds: [],
        },
      });
      const callId = newCallId();
      await identify(callId, ana);

      const reply = await callTool(
        'bookings',
        { serviceId: haircut.id, startsAt: await freeSlotFor(haircut) },
        { callId },
      );

      expect(reply.result).toMatchObject({ ok: false, reason: 'pass_required' });
      expect(await bookingsOf(ana)).toHaveLength(0);
    });

    it('does not give a student the trial exception: it is only for guests', async () => {
      await world.call('POST', url('/rates'), ownerUserId, {
        centerId,
        body: {
          name: 'Bono 10',
          sessionsCount: 10,
          validDays: 30,
          priceCents: 5000,
          serviceIds: [],
        },
      });
      const callId = newCallId();
      await identify(callId, ana);

      const reply = await callTool(
        'bookings',
        { serviceId: trialClass.id, startsAt: await freeSlotFor(trialClass) },
        { callId },
      );

      expect(reply.result).toMatchObject({ ok: false, reason: 'pass_required' });
    });

    it('creates the booking once when the provider retries the same order', async () => {
      const callId = newCallId();
      await identify(callId, ana);
      const startsAt = await freeSlotFor(haircut);
      const toolCallId = randomUUID();
      const order = { serviceId: haircut.id, startsAt };

      const first = await callTool('bookings', order, { callId, toolCallId });
      const retry = await callTool('bookings', order, { callId, toolCallId });

      expect(retry.result).toEqual(first.result);
      expect(await bookingsOf(ana)).toHaveLength(1);
    });

    it('cancels and reschedules only the bookings of the person identified in the call', async () => {
      const anaCall = newCallId();
      await identify(anaCall, ana);
      const created = await callTool(
        'bookings',
        { serviceId: haircut.id, startsAt: await freeSlotFor(haircut) },
        { callId: anaCall },
      );
      const bookingId = (created.result['booked'] as { bookingId: string }).bookingId;

      const luisCall = newCallId();
      await identify(luisCall, luis);
      const stolen = await callTool('bookings/cancel', { bookingId }, { callId: luisCall });
      const own = await callTool('bookings/cancel', { bookingId }, { callId: anaCall });

      expect(stolen.result).toMatchObject({ ok: false, reason: 'not_found' });
      expect(own.result).toMatchObject({ ok: true });
      expect(await bookingsOf(ana)).toHaveLength(0);
    });

    it('moves a booking to another hour', async () => {
      const callId = newCallId();
      await identify(callId, ana);
      const slots = await world.fetchSlots(ana.userId, centerId, haircut.id);
      const first = firstSlotAtLeast(slots, 30);
      const created = await callTool(
        'bookings',
        { serviceId: haircut.id, startsAt: first.startsAt },
        { callId },
      );
      const bookingId = (created.result['booked'] as { bookingId: string }).bookingId;
      const later = firstSlotAtLeast(slots, 60);

      const moved = await callTool(
        'bookings/reschedule',
        { bookingId, startsAt: later.startsAt },
        { callId },
      );

      expect(moved.result).toMatchObject({ ok: true });
    });
  });

  describe('trial booking for someone who is not a student', () => {
    beforeEach(async () => {
      await world.call('POST', url('/rates'), ownerUserId, {
        centerId,
        body: {
          name: 'Bono 10',
          sessionsCount: 10,
          validDays: 30,
          priceCents: 5000,
          serviceIds: [],
        },
      });
    });

    it('gives a real booking on a trial service, as a guest outside the client limit', async () => {
      const callId = newCallId();
      const reply = await callTool(
        'bookings',
        {
          serviceId: trialClass.id,
          startsAt: await freeSlotFor(trialClass),
          guestFullName: 'Pepe Invitado',
        },
        { callId },
      );

      expect(reply.result).toMatchObject({ ok: true });
      const guest = await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.membership.findFirst({
          where: { centerId, joinSource: 'voice_guest' },
          select: { isStudent: true, role: true, user: { select: { phone: true, email: true } } },
        }),
      );
      expect(guest).toMatchObject({ isStudent: false, role: 'client' });
      expect(guest?.user.phone).toBe(CALLER_NUMBER);
      expect(guest?.user.email).toMatch(/@voice-guest\.yoclick\.invalid$/);
    });

    it('asks for the name before booking a stranger', async () => {
      const reply = await callTool('bookings', {
        serviceId: trialClass.id,
        startsAt: await freeSlotFor(trialClass),
      });

      expect(reply.result).toMatchObject({ ok: false, reason: 'guest_name_required' });
    });

    it('refuses a guest any service that is not a trial and creates nobody', async () => {
      const reply = await callTool('bookings', {
        serviceId: haircut.id,
        startsAt: await freeSlotFor(haircut),
        guestFullName: 'Pepe Invitado',
      });

      expect(reply.result).toMatchObject({ ok: false, reason: 'trial_only', shouldTransfer: true });
      const guests = await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.membership.count({ where: { centerId, joinSource: 'voice_guest' } }),
      );
      expect(guests).toBe(0);
    });

    it('only offers the guest the trial services', async () => {
      const reply = await callTool('available-sessions', {});

      expect(reply.result['services']).toEqual([
        expect.objectContaining({ serviceId: trialClass.id, isTrialClass: true }),
      ]);
    });

    it('recognizes the same guest by number in a later call', async () => {
      await callTool(
        'bookings',
        {
          serviceId: trialClass.id,
          startsAt: await freeSlotFor(trialClass),
          guestFullName: 'Pepe Invitado',
        },
        { callId: newCallId() },
      );

      const later = await callTool('identify-caller', {}, { callId: newCallId() });

      expect(later.result).toMatchObject({ identified: true, isGuest: true, firstName: 'Pepe' });
    });

    it('lets a guest book any service in a center that does not use passes', async () => {
      await updateCenter({ disabledModules: ['passes'] });
      // Un centro sin bonos tampoco los vende: se archivan los que dejó el escenario.
      await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.rate.updateMany({ data: { archivedAt: new Date() } }),
      );

      const reply = await callTool('bookings', {
        serviceId: haircut.id,
        startsAt: await freeSlotFor(haircut),
        guestFullName: 'Pepe Invitado',
      });

      expect(reply.result).toMatchObject({ ok: true });
    });
  });

  describe('plan capabilities', () => {
    let fullSessionId: string;

    beforeEach(async () => {
      fullSessionId = generateUuidV7();
      const startsAt = new Date(Date.now() + 72 * HOUR_MS);
      await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
        await prisma.classSession.create({
          data: {
            id: fullSessionId,
            centerId,
            serviceId: haircut.id,
            staffMembershipId: staff.membershipId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + HOUR_MS),
            mode: 'group',
            capacity: 1,
          },
        });
        await prisma.booking.create({
          data: {
            id: generateUuidV7(),
            centerId,
            classSessionId: fullSessionId,
            clientMembershipId: luis.membershipId,
          },
        });
      });
    });

    it('joins the waitlist of a full class in Pro', async () => {
      const callId = newCallId();
      await identify(callId, ana);

      const reply = await callTool('waitlist', { classSessionId: fullSessionId }, { callId });

      expect(reply.result).toMatchObject({ ok: true, waitlisted: { position: 1 } });
    });

    it('refuses the waitlist in the basic plan and follows the plan when it changes', async () => {
      await updateCenter({ planId: 'basic' });
      const callId = newCallId();
      const identified = await identify(callId, ana);

      const reply = await callTool('waitlist', { classSessionId: fullSessionId }, { callId });

      expect(identified.result['capabilities']).toMatchObject({ canJoinWaitlist: false });
      expect(reply.result).toMatchObject({ ok: false, reason: 'waitlist_not_included' });

      await updateCenter({ planId: 'pro' });
      const afterUpgrade = await callTool(
        'waitlist',
        { classSessionId: fullSessionId },
        { callId },
      );

      expect(afterUpgrade.result).toMatchObject({ ok: true });
    });

    it('lets only Premium customize the greeting and the assistant name', async () => {
      const onPro = await world.call('PUT', url('/voice-receptionist/config'), ownerUserId, {
        centerId,
        body: { greeting: 'Hola, soy Marta, ¿en qué puedo ayudarte?' },
      });
      await updateCenter({ planId: 'premium' });
      const onPremium = await world.call('PUT', url('/voice-receptionist/config'), ownerUserId, {
        centerId,
        body: { greeting: 'Hola, soy Marta, ¿en qué puedo ayudarte?', assistantName: 'Marta' },
      });

      expect(onPro.statusCode).toBe(402);
      expect(onPro.json<{ code: string }>().code).toBe('PLAN_FEATURE_NOT_INCLUDED');
      expect(onPremium.statusCode).toBe(200);
      expect(onPremium.json()).toMatchObject({ assistantName: 'Marta' });
    });
  });

  describe('handing the call to a person', () => {
    it('has nobody to hand it to until the center sets a number', async () => {
      const reply = await callTool('transfer', {});

      expect(reply.result).toMatchObject({ ok: false, reason: 'no_transfer_number' });
    });

    it('hands it to the number of a person, never to the center own phone or the bridge number', async () => {
      await updateCenter({ phone: '+34911222333' });
      const config = (humanTransferPhone: string) =>
        world.call('PUT', url('/voice-receptionist/config'), ownerUserId, {
          centerId,
          body: { humanTransferPhone },
        });

      const loopToCenter = await config('911 22 23 33');
      const loopToBridge = await config(FIRST_BRIDGE_NUMBER);
      const valid = await config('600 99 88 77');
      const reply = await callTool('transfer', {});

      expect(loopToCenter.statusCode).toBe(422);
      expect(loopToCenter.json<{ code: string }>().code).toBe('VOICE_TRANSFER_PHONE_INVALID');
      expect(loopToBridge.statusCode).toBe(422);
      expect(valid.statusCode).toBe(200);
      expect(reply.transferToNumber).toBe('+34600998877');
    });

    it('answers the transfer destination request with the number, or with a refusal that explains why', async () => {
      const ask = () => callTool('transfer-destination', {}, { callId: newCallId() });

      const withoutNumber = await ask();
      await world.call('PUT', url('/voice-receptionist/config'), ownerUserId, {
        centerId,
        body: { humanTransferPhone: '600 99 88 77' },
      });
      const withNumber = await ask();

      expect(withoutNumber).toMatchObject({ error: expect.any(String) });
      expect(withNumber).toEqual({
        destination: { type: 'number', number: '+34600998877' },
      });
    });
  });

  describe('the single server URL of the assistant', () => {
    const sendEvent = (body: Record<string, unknown>, secret = FAKE_WEBHOOK_SECRET) =>
      world.call('POST', '/v1/webhooks/voice/events', undefined, {
        headers: { [FAKE_WEBHOOK_SECRET_HEADER]: secret },
        body,
      });
    const callPart = (callId: string) => ({
      providerCallId: callId,
      calledNumber: FIRST_BRIDGE_NUMBER,
      callerNumber: CALLER_NUMBER,
    });

    it('splits the messages by their type: end of call, transfer destination, and the rest ignored', async () => {
      const endOfCall = await sendEvent({
        messageType: 'end-of-call',
        ...callPart(newCallId()),
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        endedAt: new Date().toISOString(),
      });
      const transfer = await sendEvent({
        messageType: 'transfer-destination',
        ...callPart(newCallId()),
      });
      const other = await sendEvent({ messageType: 'status-update' });

      expect(endOfCall.statusCode).toBe(200);
      expect(endOfCall.json()).toMatchObject({ isAccepted: true });
      expect(transfer.statusCode).toBe(200);
      expect(transfer.json()).toHaveProperty('error');
      expect(other.statusCode).toBe(200);
      expect(other.json()).toEqual({});
    });

    it('rejects a wrong secret', async () => {
      const response = await sendEvent({ messageType: 'end-of-call' }, 'nope');

      expect(response.statusCode).toBe(401);
    });
  });

  describe('end of call, minutes and history', () => {
    const endOfCall = (callId: string, seconds: number, extra: object = {}) =>
      world.call('POST', '/v1/webhooks/voice/end-of-call', undefined, {
        headers: { [FAKE_WEBHOOK_SECRET_HEADER]: FAKE_WEBHOOK_SECRET },
        body: {
          providerCallId: callId,
          calledNumber: FIRST_BRIDGE_NUMBER,
          callerNumber: CALLER_NUMBER,
          startedAt: new Date(Date.now() - seconds * 1000).toISOString(),
          endedAt: new Date().toISOString(),
          summary: 'Reserva de una clase',
          transcript: 'Hola, quería una cita',
          ...extra,
        },
      });

    const usage = async () =>
      (await world.call('GET', url('/voice-receptionist/usage'), ownerUserId, { centerId })).json<{
        usage: { usedMinutes: number; includedMinutes: number };
      }>().usage;

    it('adds the started minutes to the period and ignores a repeated report', async () => {
      const callId = newCallId();
      expect((await endOfCall(callId, 121)).statusCode).toBe(200);
      await endOfCall(callId, 121);
      await endOfCall(newCallId(), 30);

      const { usedMinutes, includedMinutes } = await usage();

      expect(usedMinutes).toBe(4);
      expect(includedMinutes).toBe(250);
    });

    it('lists the calls with their result, without the transcript', async () => {
      const callId = newCallId();
      await identify(callId, ana);
      await callTool(
        'bookings',
        { serviceId: haircut.id, startsAt: await freeSlotFor(haircut) },
        { callId },
      );
      await endOfCall(callId, 90);

      const response = await world.call('GET', url('/voice-receptionist/calls'), ownerUserId, {
        centerId,
      });

      const [call] = response.json<{ data: Record<string, unknown>[] }>().data;
      expect(call).toMatchObject({
        callerName: 'ana',
        outcome: 'booking',
        durationSeconds: 90,
        hasTranscript: true,
      });
      expect(call).not.toHaveProperty('transcript');
    });

    it('deletes only the transcripts that passed the retention of the center', async () => {
      const oldCall = newCallId();
      const recentCall = newCallId();
      await endOfCall(oldCall, 60, {
        startedAt: new Date(Date.now() - 40 * DAY_MS).toISOString(),
        endedAt: new Date(Date.now() - 40 * DAY_MS + 60_000).toISOString(),
      });
      await endOfCall(recentCall, 60);

      const cleared = await application.get(VoiceTranscriptSweeper).clearExpired();
      const response = await world.call('GET', url('/voice-receptionist/calls'), ownerUserId, {
        centerId,
      });

      const calls = response.json<{ data: { hasTranscript: boolean; durationSeconds: number }[] }>()
        .data;
      expect(cleared).toBe(1);
      expect(calls.filter((call) => call.hasTranscript)).toHaveLength(1);
      expect(calls.filter((call) => !call.hasTranscript)).toHaveLength(1);
      expect(calls.every((call) => call.durationSeconds === 60)).toBe(true);
    });

    it('reads usage and settings in the panel overview', async () => {
      const response = await world.call('GET', url('/voice-receptionist'), ownerUserId, {
        centerId,
      });

      expect(response.json()).toMatchObject({
        isEnabled: true,
        line: { phoneNumber: FIRST_BRIDGE_NUMBER, isActive: true },
        subscription: { status: 'active', includedMinutes: 250 },
        addonPlan: { monthlyPriceCents: 6900, includedMinutes: 250, overageCentsPerMinute: 35 },
        capabilities: { canJoinWaitlist: true, canCustomizeAssistant: false },
      });
    });
  });
});
