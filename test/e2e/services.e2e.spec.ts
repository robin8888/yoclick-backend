import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter, type TestService } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

describe('services', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;
  let staff: { userId: string; membershipId: string };
  let client: { userId: string; membershipId: string };

  const servicesUrl = (path = ''): string => `/v1/centers/${center.centerId}/services${path}`;

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
    client = await world.addMember(center.centerId, 'client', 'client');
  });

  afterAll(async () => {
    await application.close();
  });

  describe('a new center', () => {
    it('starts with the suggested services of its sector, all individual, visible and run by the owner', async () => {
      const services = await world.listServices(owner, center.centerId);

      expect(services.map(({ name }) => name)).toEqual([
        'Karate infantil',
        'Karate adultos',
        'Kickboxing',
        'Clase particular',
      ]);
      expect(services.map(({ durationMinutes }) => durationMinutes)).toEqual([60, 75, 60, 60]);
      for (const service of services) {
        expect(service).toMatchObject({
          kind: 'individual',
          currency: 'EUR',
          priceCents: null,
          description: null,
          color: null,
          bookingWindowDays: 30,
          minNoticeMinutes: 120,
          isVisible: true,
        });
        expect(service.staff).toEqual([
          { membershipId: center.ownerMembershipId, fullName: 'owner' },
        ]);
      }
    });

    it('starts with the default opening hours: Monday to Friday, mornings and afternoons', async () => {
      const response = await world.call('GET', `/v1/centers/${center.centerId}`, owner, {
        centerId: center.centerId,
      });

      const { openingHours } = response.json<{ openingHours: Record<string, unknown[]> }>();
      expect(openingHours['mon']).toEqual([
        { opensAt: '09:00', closesAt: '14:00' },
        { opensAt: '16:00', closesAt: '20:00' },
      ]);
      expect(openingHours['fri']).toHaveLength(2);
      expect(openingHours['sat']).toEqual([]);
      expect(openingHours['sun']).toEqual([]);
    });
  });

  describe('POST /services', () => {
    it('creates a service run by whoever creates it unless told otherwise', async () => {
      const response = await world.call('POST', servicesUrl(), owner, {
        centerId: center.centerId,
        body: { name: 'Masaje deportivo', durationMinutes: 45, priceCents: 3500, color: '#e4572e' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<TestService>()).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        name: 'Masaje deportivo',
        description: null,
        kind: 'individual',
        durationMinutes: 45,
        priceCents: 3500,
        currency: 'EUR',
        color: '#E4572E',
        bookingWindowDays: 30,
        minNoticeMinutes: 120,
        isVisible: true,
        room: null,
        staff: [{ membershipId: center.ownerMembershipId, fullName: 'owner' }],
      });
    });

    it('lets an admin choose the team that runs it', async () => {
      const response = await world.call('POST', servicesUrl(), owner, {
        centerId: center.centerId,
        body: {
          name: 'Taller',
          durationMinutes: 90,
          staffMembershipIds: [staff.membershipId, center.ownerMembershipId],
          bookingWindowDays: 60,
          minNoticeMinutes: 0,
          isVisible: false,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<TestService & { isVisible: boolean }>()).toMatchObject({
        isVisible: false,
        bookingWindowDays: 60,
        minNoticeMinutes: 0,
      });
      const byText = (first: string, second: string): number => first.localeCompare(second);
      expect(
        response
          .json<TestService>()
          .staff.map(({ membershipId }) => membershipId)
          .sort(byText),
      ).toEqual([staff.membershipId, center.ownerMembershipId].sort(byText));
    });

    it.each([
      ['a name that is too short', { name: 'A', durationMinutes: 60 }],
      ['a duration that is not a multiple of 5', { name: 'Clase', durationMinutes: 47 }],
      ['a duration over 8 hours', { name: 'Clase', durationMinutes: 485 }],
      ['a duration under 15 minutes', { name: 'Clase', durationMinutes: 10 }],
      ['a negative price', { name: 'Clase', durationMinutes: 60, priceCents: -1 }],
      ['a color that is not #RRGGBB', { name: 'Clase', durationMinutes: 60, color: 'red' }],
      [
        'a booking window of zero days',
        { name: 'Clase', durationMinutes: 60, bookingWindowDays: 0 },
      ],
      ['an empty team', { name: 'Clase', durationMinutes: 60, staffMembershipIds: [] }],
      [
        'fields the API does not accept (center, kind, capacity)',
        { name: 'Clase', durationMinutes: 60, kind: 'group', capacity: 8 },
      ],
    ])('rejects %s with 400', async (_description, body) => {
      const response = await world.call('POST', servicesUrl(), owner, {
        centerId: center.centerId,
        body,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rejects someone who is not an active team member of this center (a client, or another center)', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro Centro');

      for (const membershipId of [client.membershipId, otherCenter.ownerMembershipId]) {
        const response = await world.call('POST', servicesUrl(), owner, {
          centerId: center.centerId,
          body: { name: 'Clase', durationMinutes: 60, staffMembershipIds: [membershipId] },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ path: 'staffMembershipIds', code: 'unknown_staff_member' }],
        });
      }
    });
  });

  describe('PATCH /services/:serviceId', () => {
    let service: TestService;

    beforeEach(async () => {
      service = await world.createService(owner, center.centerId, {
        name: 'Masaje',
        description: 'Con aceites',
        durationMinutes: 45,
        priceCents: 3000,
        color: '#112233',
      });
    });

    it('changes only what is sent and clears fields with null', async () => {
      const response = await world.call('PATCH', servicesUrl(`/${service.id}`), owner, {
        centerId: center.centerId,
        body: { name: 'Masaje relajante', priceCents: null, description: null, isVisible: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        name: 'Masaje relajante',
        priceCents: null,
        description: null,
        isVisible: false,
        durationMinutes: 45,
        color: '#112233',
      });
    });

    it('replaces the team that runs the service', async () => {
      const response = await world.call('PATCH', servicesUrl(`/${service.id}`), owner, {
        centerId: center.centerId,
        body: { staffMembershipIds: [staff.membershipId] },
      });

      expect(response.json<TestService>().staff).toEqual([
        { membershipId: staff.membershipId, fullName: 'staff' },
      ]);
    });

    it('rejects an empty change and unknown fields with 400', async () => {
      const empty = await world.call('PATCH', servicesUrl(`/${service.id}`), owner, {
        centerId: center.centerId,
        body: {},
      });
      const unknownField = await world.call('PATCH', servicesUrl(`/${service.id}`), owner, {
        centerId: center.centerId,
        body: { centerId: center.centerId },
      });

      expect(empty.statusCode).toBe(400);
      expect(unknownField.statusCode).toBe(400);
    });

    it('answers 404 for a service that does not exist', async () => {
      const response = await world.call(
        'PATCH',
        servicesUrl('/0192f3b4-0000-7000-8000-000000000000'),
        owner,
        { centerId: center.centerId, body: { name: 'Nada' } },
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /services/:serviceId', () => {
    it('archives the service: it disappears from the lists but its row is kept', async () => {
      const [service] = await world.listServices(owner, center.centerId);

      const response = await world.call('DELETE', servicesUrl(`/${service?.id ?? ''}`), owner, {
        centerId: center.centerId,
      });

      expect(response.statusCode).toBe(204);
      const remaining = await world.listServices(owner, center.centerId);
      expect(remaining.map(({ id }) => id)).not.toContain(service?.id);
      const kept = await world.tenantPrismaService.runInTenantContext(
        {
          userId: owner,
          centerId: center.centerId,
          membershipId: center.ownerMembershipId,
          role: 'owner',
          permissions: [],
        },
        (prisma) => prisma.service.findUnique({ where: { id: service?.id ?? '' } }),
      );
      expect(kept?.archivedAt).toBeInstanceOf(Date);
    });

    it('answers 404 when archiving twice, and for an archived service in PATCH', async () => {
      const [service] = await world.listServices(owner, center.centerId);
      const url = servicesUrl(`/${service?.id ?? ''}`);
      await world.call('DELETE', url, owner, { centerId: center.centerId });

      const again = await world.call('DELETE', url, owner, { centerId: center.centerId });
      const patch = await world.call('PATCH', url, owner, {
        centerId: center.centerId,
        body: { name: 'Revivido' },
      });

      expect(again.statusCode).toBe(404);
      expect(patch.statusCode).toBe(404);
    });
  });

  describe('who can do what', () => {
    it('lets the team read services but not change them (403)', async () => {
      const [service] = await world.listServices(owner, center.centerId);
      const url = servicesUrl(`/${service?.id ?? ''}`);
      const options = { centerId: center.centerId };

      expect((await world.call('GET', servicesUrl(), staff.userId, options)).statusCode).toBe(200);
      const create = await world.call('POST', servicesUrl(), staff.userId, {
        ...options,
        body: { name: 'Clase', durationMinutes: 60 },
      });
      expect(create.statusCode).toBe(403);
      expect(
        (await world.call('PATCH', url, staff.userId, { ...options, body: { name: 'X1' } }))
          .statusCode,
      ).toBe(403);
      expect((await world.call('DELETE', url, staff.userId, options)).statusCode).toBe(403);
    });

    it('does not let a client change services (403)', async () => {
      const response = await world.call('POST', servicesUrl(), client.userId, {
        centerId: center.centerId,
        body: { name: 'Clase', durationMinutes: 60 },
      });

      expect(response.statusCode).toBe(403);
    });

    it('shows clients only visible services, while the team sees the hidden ones too', async () => {
      const [service] = await world.listServices(owner, center.centerId);
      await world.call('PATCH', servicesUrl(`/${service?.id ?? ''}`), owner, {
        centerId: center.centerId,
        body: { isVisible: false },
      });

      const forClient = await world.listServices(client.userId, center.centerId);
      const forStaff = await world.listServices(staff.userId, center.centerId);

      expect(forClient.map(({ id }) => id)).not.toContain(service?.id);
      expect(forClient).toHaveLength(3);
      expect(forStaff.map(({ id }) => id)).toContain(service?.id);
      expect(forStaff).toHaveLength(4);
    });

    it('requires a second-factor session to administer services', async () => {
      const response = await world.call('POST', servicesUrl(), owner, {
        centerId: center.centerId,
        body: { name: 'Clase', durationMinutes: 60 },
        isMfaVerified: false,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'MFA_REQUIRED' });
    });

    it('requires a session (401)', async () => {
      const response = await world.call('GET', servicesUrl(), undefined, {
        centerId: center.centerId,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('isolation between centers', () => {
    let otherCenter: CreatedTestCenter;
    let otherOwner: string;

    beforeEach(async () => {
      otherOwner = await world.fixtures.createUser('other-owner');
      otherCenter = await world.createCenter(otherOwner, 'Otro Centro');
    });

    it('answers 404 to someone who does not belong to the center, with or without the right header', async () => {
      const withCenterHeader = await world.call('GET', servicesUrl(), otherOwner, {
        centerId: center.centerId,
      });
      const withOwnHeaderOnForeignRoute = await world.call('GET', servicesUrl(), otherOwner, {
        centerId: otherCenter.centerId,
      });

      expect(withCenterHeader.statusCode).toBe(404);
      expect(withOwnHeaderOnForeignRoute.statusCode).toBe(404);
    });

    it('never touches a service of another center, even knowing its id (404)', async () => {
      const [foreignService] = await world.listServices(otherOwner, otherCenter.centerId);
      const url = `/v1/centers/${center.centerId}/services/${foreignService?.id ?? ''}`;

      const patch = await world.call('PATCH', url, owner, {
        centerId: center.centerId,
        body: { name: 'Robado' },
      });
      const archive = await world.call('DELETE', url, owner, { centerId: center.centerId });

      expect(patch.statusCode).toBe(404);
      expect(archive.statusCode).toBe(404);
      const untouched = await world.listServices(otherOwner, otherCenter.centerId);
      expect(untouched.map(({ name }) => name)).not.toContain('Robado');
      expect(untouched).toHaveLength(4);
    });

    it('lists only the services of the center in the header', async () => {
      await world.createService(otherOwner, otherCenter.centerId, {
        name: 'Solo del otro',
        durationMinutes: 30,
      });

      const mine = await world.listServices(owner, center.centerId);

      expect(mine.map(({ name }) => name)).not.toContain('Solo del otro');
      expect(mine).toHaveLength(4);
    });
  });
});
