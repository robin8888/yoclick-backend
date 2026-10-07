import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter, type TestSlot } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface NotificationBody {
  id: string;
  kind: string;
  data: Record<string, string>;
  bookingId: string | null;
  isRead: boolean;
}

interface NotificationListBody {
  unreadCount: number;
  notifications: NotificationBody[];
}

describe('notifications', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let serviceId: string;
  let bookedSlot: TestSlot;
  let bookingId: string;

  const notificationsUrl = (path = ''): string =>
    `/v1/centers/${center.centerId}/notifications${path}`;

  async function listFor(userId: string): Promise<NotificationListBody> {
    const response = await world.call('GET', notificationsUrl(), userId, {
      centerId: center.centerId,
    });
    return response.json<NotificationListBody>();
  }

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
    ana = await world.addMember(center.centerId, 'ana', 'client');
    serviceId = (
      await world.createService(owner, center.centerId, {
        name: 'Sesión personal',
        durationMinutes: 60,
        minNoticeMinutes: 0,
        staffMembershipIds: [staff.membershipId],
      })
    ).id;
    const slots = await world.fetchSlots(ana.userId, center.centerId, serviceId);
    bookedSlot = slots[0] as TestSlot;
    const booked = await world.book(ana.userId, center.centerId, {
      serviceId,
      startsAt: bookedSlot.startsAt,
      staffMembershipId: bookedSlot.staffMembershipId,
    });
    bookingId = booked.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await application.close();
  });

  it('tells the professional and the owner about a new booking, but not the client who made it', async () => {
    const forStaff = await listFor(staff.userId);
    const forOwner = await listFor(owner);

    expect(forStaff.unreadCount).toBe(1);
    expect(forStaff.notifications[0]).toMatchObject({
      kind: 'booking_created',
      bookingId,
      isRead: false,
      data: {
        clientName: 'ana',
        serviceName: 'Sesión personal',
        startsAt: bookedSlot.startsAt,
        staffName: 'staff',
      },
    });
    expect(forOwner.unreadCount).toBe(1);
    const asClient = await world.call('GET', notificationsUrl(), ana.userId, {
      centerId: center.centerId,
    });
    // Quien hizo la reserva no recibe aviso de lo que él mismo hizo.
    expect(asClient.statusCode).toBe(200);
    expect(asClient.json<NotificationListBody>().unreadCount).toBe(0);
  });

  it('adds a notice when the client cancels, newest first', async () => {
    await world.call(
      'POST',
      `/v1/centers/${center.centerId}/bookings/${bookingId}/cancel`,
      ana.userId,
      {
        centerId: center.centerId,
      },
    );

    const forStaff = await listFor(staff.userId);

    expect(forStaff.unreadCount).toBe(2);
    expect(forStaff.notifications.map(({ kind }) => kind)).toEqual([
      'booking_cancelled',
      'booking_created',
    ]);
  });

  it('marks one notice as read, only for its owner', async () => {
    const [notice] = (await listFor(staff.userId)).notifications as [NotificationBody];

    const marked = await world.call('POST', notificationsUrl(`/${notice.id}/read`), staff.userId, {
      centerId: center.centerId,
    });
    const intruder = await world.call('POST', notificationsUrl(`/${notice.id}/read`), owner, {
      centerId: center.centerId,
    });

    expect(marked.statusCode).toBe(204);
    expect(intruder.statusCode).toBe(404);
    expect((await listFor(staff.userId)).unreadCount).toBe(0);
    expect((await listFor(owner)).unreadCount).toBe(1);
  });

  it('marks all of them as read', async () => {
    await world.call(
      'POST',
      `/v1/centers/${center.centerId}/bookings/${bookingId}/cancel`,
      ana.userId,
      {
        centerId: center.centerId,
      },
    );

    const response = await world.call('POST', notificationsUrl('/read'), staff.userId, {
      centerId: center.centerId,
    });

    expect(response.statusCode).toBe(204);
    const list = await listFor(staff.userId);
    expect(list.unreadCount).toBe(0);
    expect(list.notifications.every(({ isRead }) => isRead)).toBe(true);
  });

  it('limits the list and never shows the notices of another center', async () => {
    const limited = await world.call('GET', notificationsUrl('?limit=1'), owner, {
      centerId: center.centerId,
    });
    const otherOwner = await world.fixtures.createUser('otherowner');
    const otherCenter = await world.createCenter(otherOwner, 'Otro centro');
    const foreign = await world.call(
      'GET',
      `/v1/centers/${otherCenter.centerId}/notifications`,
      otherOwner,
      { centerId: otherCenter.centerId },
    );

    expect(limited.json<NotificationListBody>().notifications).toHaveLength(1);
    expect(foreign.json<NotificationListBody>()).toEqual({ unreadCount: 0, notifications: [] });
  });
});
