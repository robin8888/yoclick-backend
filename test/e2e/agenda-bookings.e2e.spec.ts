import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter, type TestSlot } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface BookingBody {
  id: string;
  status: string;
  startsAt: string;
  staff: { membershipId: string };
}

describe('POST /agenda/bookings (an appointment made by the team)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;
  let staff: { userId: string; membershipId: string };
  let otherStaff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let serviceId: string;
  let slot: TestSlot;

  const agendaBookingsUrl = (): string => `/v1/centers/${center.centerId}/agenda/bookings`;

  const createFor = (userId: string, body: object) =>
    world.call('POST', agendaBookingsUrl(), userId, { centerId: center.centerId, body });

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    await world.openAllWeek(owner, center.centerId);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
    otherStaff = await world.addMember(center.centerId, 'otherstaff', 'staff');
    ana = await world.addMember(center.centerId, 'ana', 'client');
    serviceId = (
      await world.createService(owner, center.centerId, {
        name: 'Sesión personal',
        durationMinutes: 60,
        minNoticeMinutes: 0,
        staffMembershipIds: [staff.membershipId, otherStaff.membershipId],
      })
    ).id;
    slot = (
      await world.fetchSlots(owner, center.centerId, serviceId, staff.membershipId)
    )[0] as TestSlot;
  });

  afterAll(async () => {
    await application.close();
  });

  it('lets a professional book a client on their own agenda, and the client sees it', async () => {
    const response = await createFor(staff.userId, {
      clientMembershipId: ana.membershipId,
      serviceId,
      startsAt: slot.startsAt,
    });

    expect(response.statusCode).toBe(201);
    const booking = response.json<BookingBody>();
    expect(booking).toMatchObject({ status: 'confirmed', startsAt: slot.startsAt });
    expect(booking.staff.membershipId).toBe(staff.membershipId);
    const mine = await world.call(
      'GET',
      `/v1/centers/${center.centerId}/bookings/mine?scope=upcoming`,
      ana.userId,
      { centerId: center.centerId },
    );
    expect(mine.json<{ bookings: BookingBody[] }>().bookings.map(({ id }) => id)).toContain(
      booking.id,
    );
  });

  it('lets the team book at a quarter of an hour, which the client grid never offers', async () => {
    const fineSlots = await world.call(
      'GET',
      `/v1/centers/${center.centerId}/availability?serviceId=${serviceId}&from=${slot.startsAt.slice(0, 10)}&to=${slot.startsAt.slice(0, 10)}&stepMinutes=15&staffMembershipId=${staff.membershipId}`,
      staff.userId,
      { centerId: center.centerId },
    );
    const quarterPast = new Date(Date.parse(slot.startsAt) + 15 * 60_000).toISOString();

    const days = fineSlots.json<{ days: { slots: { startsAt: string }[] }[] }>().days;
    expect(days.flatMap((day) => day.slots.map(({ startsAt }) => startsAt))).toContain(quarterPast);
    const response = await createFor(staff.userId, {
      clientMembershipId: ana.membershipId,
      serviceId,
      startsAt: quarterPast,
    });
    expect(response.statusCode).toBe(201);
  });

  it('lets administration choose the professional', async () => {
    const response = await createFor(owner, {
      clientMembershipId: ana.membershipId,
      serviceId,
      startsAt: slot.startsAt,
      staffMembershipId: staff.membershipId,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<BookingBody>().staff.membershipId).toBe(staff.membershipId);
  });

  it('does not let a professional book on someone else agenda', async () => {
    const response = await createFor(staff.userId, {
      clientMembershipId: ana.membershipId,
      serviceId,
      startsAt: slot.startsAt,
      staffMembershipId: otherStaff.membershipId,
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a taken slot, a double booking of the client and unknown clients', async () => {
    const body = { clientMembershipId: ana.membershipId, serviceId, startsAt: slot.startsAt };
    await createFor(staff.userId, body);
    const bruno = await world.addMember(center.centerId, 'bruno', 'client');

    const takenSlot = await createFor(staff.userId, {
      ...body,
      clientMembershipId: bruno.membershipId,
    });
    const sameClientTwice = await createFor(otherStaff.userId, body);
    const stranger = await createFor(staff.userId, {
      ...body,
      clientMembershipId: staff.membershipId,
    });

    expect(takenSlot.statusCode).toBe(409);
    expect(sameClientTwice.statusCode).toBe(409);
    expect(stranger.statusCode).toBe(404);
  });

  it('is not open to clients', async () => {
    const response = await createFor(ana.userId, {
      clientMembershipId: ana.membershipId,
      serviceId,
      startsAt: slot.startsAt,
    });

    expect(response.statusCode).toBe(403);
  });

  it('tells administration about it, but not the professional who made it', async () => {
    await createFor(staff.userId, {
      clientMembershipId: ana.membershipId,
      serviceId,
      startsAt: slot.startsAt,
    });

    const forOwner = await world.call(
      'GET',
      `/v1/centers/${center.centerId}/notifications`,
      owner,
      {
        centerId: center.centerId,
      },
    );
    const forStaff = await world.call(
      'GET',
      `/v1/centers/${center.centerId}/notifications`,
      staff.userId,
      {
        centerId: center.centerId,
      },
    );

    expect(forOwner.json<{ unreadCount: number }>().unreadCount).toBe(1);
    expect(forStaff.json<{ unreadCount: number }>().unreadCount).toBe(0);
  });
});
