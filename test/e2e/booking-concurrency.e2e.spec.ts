import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type LightMyRequestResponse } from 'fastify';
import {
  BookingWorld,
  firstSlotAtLeast,
  type CreatedTestCenter,
  type TestService,
} from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const SIMULTANEOUS_CLIENTS = 20;
const CONCURRENCY_TEST_TIMEOUT_MS = 30_000;
const HOURS_AHEAD_FOR_SLOT = 72;

interface BookingBody {
  id: string;
  staff: { membershipId: string };
}

function countByStatus(responses: readonly LightMyRequestResponse[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const { statusCode } of responses) counts[statusCode] = (counts[statusCode] ?? 0) + 1;
  return counts;
}

function errorCodesOf(responses: readonly LightMyRequestResponse[]): string[] {
  return responses
    .filter(({ statusCode }) => statusCode !== 201)
    .map((response) => response.json<{ code: string }>().code);
}

describe('concurrent bookings', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let service: TestService;
  let clients: { userId: string; membershipId: string }[];

  async function addClients(count: number): Promise<void> {
    clients = [];
    for (let index = 0; index < count; index += 1) {
      clients.push(await world.addMember(center.centerId, `client-${String(index)}`, 'client'));
    }
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    await world.openAllWeek(ownerUserId, center.centerId);
    service = await world.createService(ownerUserId, center.centerId, {
      name: 'Sesión personal',
      durationMinutes: 60,
    });
  });

  afterAll(async () => {
    await application.close();
  });

  it(
    `lets exactly one of ${String(SIMULTANEOUS_CLIENTS)} clients book the same slot and answers 409 SLOT_UNAVAILABLE to the rest`,
    async () => {
      await addClients(SIMULTANEOUS_CLIENTS);
      const slot = firstSlotAtLeast(
        await world.fetchSlots(clients[0]?.userId ?? '', center.centerId, service.id),
        HOURS_AHEAD_FOR_SLOT,
      );

      const responses = await Promise.all(
        clients.map((client) =>
          world.book(client.userId, center.centerId, {
            serviceId: service.id,
            startsAt: slot.startsAt,
          }),
        ),
      );

      expect(countByStatus(responses)).toEqual({ 201: 1, 409: SIMULTANEOUS_CLIENTS - 1 });
      expect(new Set(errorCodesOf(responses))).toEqual(new Set(['SLOT_UNAVAILABLE']));
      const scheduledSessions = await world.tenantPrismaService.runInTenantContext(
        {
          userId: ownerUserId,
          centerId: center.centerId,
          membershipId: center.ownerMembershipId,
          role: 'owner',
          permissions: [],
        },
        (prisma) =>
          prisma.classSession.count({
            where: { startsAt: new Date(slot.startsAt), status: 'scheduled' },
          }),
      );
      expect(scheduledSessions).toBe(1);
    },
    CONCURRENCY_TEST_TIMEOUT_MS,
  );

  it(
    'keeps one confirmed booking when the same client taps several times with different keys (ALREADY_BOOKED)',
    async () => {
      await addClients(1);
      const [client] = clients;
      const slot = firstSlotAtLeast(
        await world.fetchSlots(client?.userId ?? '', center.centerId, service.id),
        HOURS_AHEAD_FOR_SLOT,
      );

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          world.book(client?.userId ?? '', center.centerId, {
            serviceId: service.id,
            startsAt: slot.startsAt,
          }),
        ),
      );

      expect(countByStatus(responses)).toEqual({ 201: 1, 409: 5 });
      expect(new Set(errorCodesOf(responses))).toEqual(new Set(['ALREADY_BOOKED']));
    },
    CONCURRENCY_TEST_TIMEOUT_MS,
  );

  it(
    'books one slot per free professional when several clients ask at once',
    async () => {
      const staff = await world.addMember(center.centerId, 'staff', 'staff');
      await world.call(
        'PATCH',
        `/v1/centers/${center.centerId}/services/${service.id}`,
        ownerUserId,
        {
          centerId: center.centerId,
          body: { staffMembershipIds: [center.ownerMembershipId, staff.membershipId] },
        },
      );
      await addClients(5);
      const slot = firstSlotAtLeast(
        await world.fetchSlots(clients[0]?.userId ?? '', center.centerId, service.id),
        HOURS_AHEAD_FOR_SLOT,
      );

      const responses = await Promise.all(
        clients.map((client) =>
          world.book(client.userId, center.centerId, {
            serviceId: service.id,
            startsAt: slot.startsAt,
          }),
        ),
      );

      expect(countByStatus(responses)).toEqual({ 201: 2, 409: 3 });
      const professionals = responses
        .filter(({ statusCode }) => statusCode === 201)
        .map((response) => response.json<BookingBody>().staff.membershipId);
      expect(new Set(professionals)).toEqual(
        new Set([center.ownerMembershipId, staff.membershipId]),
      );
    },
    CONCURRENCY_TEST_TIMEOUT_MS,
  );

  it(
    'never double-books a professional across overlapping starts of different lengths',
    async () => {
      const longService = await world.createService(ownerUserId, center.centerId, {
        name: 'Sesión larga',
        durationMinutes: 90,
      });
      await addClients(8);
      const hourSlot = firstSlotAtLeast(
        await world.fetchSlots(clients[0]?.userId ?? '', center.centerId, service.id),
        HOURS_AHEAD_FOR_SLOT,
      );
      const longSlots = await world.fetchSlots(
        clients[0]?.userId ?? '',
        center.centerId,
        longService.id,
      );
      const overlappingLongSlot = longSlots.find(
        (slot) =>
          Date.parse(slot.startsAt) < Date.parse(hourSlot.endsAt) &&
          Date.parse(hourSlot.startsAt) < Date.parse(slot.endsAt),
      );

      const responses = await Promise.all(
        clients.map((client, index) =>
          world.book(client.userId, center.centerId, {
            serviceId: index % 2 === 0 ? service.id : longService.id,
            startsAt: index % 2 === 0 ? hourSlot.startsAt : (overlappingLongSlot?.startsAt ?? ''),
          }),
        ),
      );

      expect(overlappingLongSlot).toBeDefined();
      expect(countByStatus(responses)[201]).toBe(1);
    },
    CONCURRENCY_TEST_TIMEOUT_MS,
  );
});
