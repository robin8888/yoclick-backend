import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type PushSendResult,
} from '../../src/modules/push/application/ports/push-sender';
import { type TenantTransactionClient } from '../../src/shared/database/tenant-prisma.service';
import { BookingWorld, firstSlotAtLeast, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MIN_HOURS_AHEAD = 24;
const TOKEN_OWNER = 'ExponentPushToken[owner-device-0001]';
const TOKEN_STAFF = 'ExponentPushToken[staff-device-0001]';

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

interface ProfileBody {
  membershipId: string;
  isMe: boolean;
  fullName: string;
  headline: string | null;
  bio: string | null;
  specialties: string[];
  languages: string[];
  status: string;
  reviewNote: string | null;
  hasPublishConsent: boolean;
  certifications: { id: string; name: string; detail: string | null; isVerified: boolean }[];
  rating: { average: number; count: number } | null;
}

interface ReviewBody {
  id: string;
  authorLabel: string;
  rating: number;
  comment: string | null;
  status: string;
}

const CONTENT = {
  headline: 'Entrenadora · 9 años de experiencia',
  bio: 'Ayudo a personas de cualquier nivel a progresar.',
  specialties: ['Fuerza', 'Movilidad'],
  languages: ['Castellano', 'Inglés'],
  hasPublishConsent: true,
};

describe('team profiles', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let center: CreatedTestCenter;
  let owner: string;
  let staff: { userId: string; membershipId: string };
  let otherStaff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  const pushSender = new RecordingPushSender();

  const url = (path: string): string => `/v1/centers/${center.centerId}${path}`;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    userId: string,
    body?: object,
  ) => world.call(method, url(path), userId, { centerId: center.centerId, ...(body && { body }) });
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

  const saveContent = (userId: string, content: object = CONTENT) =>
    call('PUT', '/team-profiles/me', userId, content);
  const listFor = async (userId: string) =>
    (await call('GET', '/team-profiles', userId)).json<{ members: ProfileBody[] }>().members;
  const profileOf = async (userId: string, membershipId: string) =>
    (await listFor(userId)).find((member) => member.membershipId === membershipId);
  async function noticeKindsOf(userId: string): Promise<string[]> {
    const response = await call('GET', '/notifications', userId);
    return response
      .json<{ notifications: { kind: string }[] }>()
      .notifications.map(({ kind }) => kind);
  }

  async function publishStaffProfile(): Promise<void> {
    await saveContent(staff.userId);
    await call('POST', '/team-profiles/me/submit', staff.userId);
    await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
      decision: 'approve',
    });
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
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
    otherStaff = await world.addMember(center.centerId, 'other-staff', 'staff');
    ana = await world.addMember(center.centerId, 'ana', 'client');
    await world.call('PUT', '/v1/me/push-token', owner, {
      body: { token: TOKEN_OWNER, platform: 'ios' },
    });
    await world.call('PUT', '/v1/me/push-token', staff.userId, {
      body: { token: TOKEN_STAFF, platform: 'ios' },
    });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('writing and sending the profile', () => {
    it('saves what is written, cleaning the lists, and keeps it as a draft', async () => {
      const response = await saveContent(staff.userId, {
        ...CONTENT,
        specialties: ['  Fuerza ', 'fuerza', '', 'Movilidad'],
        bio: '   ',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<ProfileBody>()).toMatchObject({
        isMe: true,
        headline: CONTENT.headline,
        bio: null,
        specialties: ['Fuerza', 'Movilidad'],
        languages: ['Castellano', 'Inglés'],
        status: 'draft',
        hasPublishConsent: true,
      });
    });

    it('refuses texts that are too long and unknown fields', async () => {
      expect(
        (await saveContent(staff.userId, { ...CONTENT, headline: 'a'.repeat(121) })).statusCode,
      ).toBe(400);
      expect(
        (await saveContent(staff.userId, { ...CONTENT, status: 'published' })).statusCode,
      ).toBe(400);
    });

    it('is not for clients', async () => {
      expect((await saveContent(ana.userId)).statusCode).toBe(403);
    });

    it('does not send a profile without the authorization to publish, nor an empty one', async () => {
      await saveContent(staff.userId, { ...CONTENT, hasPublishConsent: false });
      const withoutConsent = await call('POST', '/team-profiles/me/submit', staff.userId);
      await saveContent(otherStaff.userId, {
        headline: null,
        bio: null,
        specialties: [],
        languages: [],
        hasPublishConsent: true,
      });
      const empty = await call('POST', '/team-profiles/me/submit', otherStaff.userId);

      expect(withoutConsent.json<{ code: string }>().code).toBe('PROFILE_CONSENT_REQUIRED');
      expect(empty.json<{ code: string }>().code).toBe('PROFILE_EMPTY');
    });

    it('waits for the review of the center when the team sends it, and tells the administration', async () => {
      await saveContent(staff.userId);

      const response = await call('POST', '/team-profiles/me/submit', staff.userId);

      expect(response.json<ProfileBody>().status).toBe('pending');
      expect(await noticeKindsOf(owner)).toContain('staff_profile_submitted');
      expect(pushSender.tokensFor('staff_profile_submitted')).toEqual([TOKEN_OWNER]);
    });

    it('publishes directly what the owner sends', async () => {
      await saveContent(owner);

      const response = await call('POST', '/team-profiles/me/submit', owner);

      expect(response.json<ProfileBody>().status).toBe('published');
    });
  });

  describe('what each person sees', () => {
    it('shows the clients only the published profiles', async () => {
      await saveContent(staff.userId);
      await call('POST', '/team-profiles/me/submit', staff.userId);

      expect(await listFor(ana.userId)).toEqual([]);
      const detail = await call('GET', `/team-profiles/${staff.membershipId}`, ana.userId);
      expect(detail.statusCode).toBe(404);
    });

    it('shows the team the published ones and their own, and the administration all', async () => {
      await saveContent(staff.userId);
      await saveContent(otherStaff.userId);

      const seenByStaff = (await listFor(staff.userId)).map(({ membershipId }) => membershipId);
      const seenByOwner = (await listFor(owner)).map(({ membershipId }) => membershipId);

      expect(seenByStaff).toEqual([staff.membershipId]);
      expect(seenByOwner).toEqual(
        expect.arrayContaining([
          center.ownerMembershipId,
          staff.membershipId,
          otherStaff.membershipId,
        ]),
      );
    });

    it('lets the clients read a published profile without the notes of the review', async () => {
      await publishStaffProfile();

      const detail = await call('GET', `/team-profiles/${staff.membershipId}`, ana.userId);

      expect(detail.statusCode).toBe(200);
      expect(detail.json<ProfileBody>()).toMatchObject({
        fullName: expect.any(String),
        headline: CONTENT.headline,
        status: 'published',
        reviewNote: null,
      });
    });

    it('takes a published profile out of sight when it is edited, until it is sent and approved again', async () => {
      await publishStaffProfile();

      await saveContent(staff.userId, { ...CONTENT, bio: 'Texto nuevo.' });

      expect(await listFor(ana.userId)).toEqual([]);
      await call('POST', '/team-profiles/me/submit', staff.userId);
      await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
        decision: 'approve',
      });
      expect((await listFor(ana.userId)).map(({ bio }) => bio)).toEqual(['Texto nuevo.']);
    });
  });

  describe('the review of the center', () => {
    beforeEach(async () => {
      await saveContent(staff.userId);
      await call('POST', '/team-profiles/me/submit', staff.userId);
      pushSender.sent.length = 0;
    });

    it('approves and publishes, and tells the person', async () => {
      const response = await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
        decision: 'approve',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<ProfileBody>().status).toBe('published');
      expect(await noticeKindsOf(staff.userId)).toContain('staff_profile_reviewed');
      expect(pushSender.tokensFor('staff_profile_reviewed')).toEqual([TOKEN_STAFF]);
      expect((await listFor(ana.userId)).map(({ membershipId }) => membershipId)).toEqual([
        staff.membershipId,
      ]);
    });

    it('asks for changes with a note that only the person and the administration read', async () => {
      const withoutNote = await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
        decision: 'request_changes',
      });
      const withNote = await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
        decision: 'request_changes',
        note: 'Cuenta algo más de ti.',
      });

      expect(withoutNote.statusCode).toBe(400);
      expect(withNote.json<ProfileBody>()).toMatchObject({
        status: 'changes_requested',
        reviewNote: 'Cuenta algo más de ti.',
      });
      expect((await profileOf(staff.userId, staff.membershipId))?.reviewNote).toBe(
        'Cuenta algo más de ti.',
      );
      expect(await listFor(ana.userId)).toEqual([]);
    });

    it('is only for the administration and cannot be done twice', async () => {
      const byTeam = await call(
        'POST',
        `/team-profiles/${staff.membershipId}/review`,
        staff.userId,
        {
          decision: 'approve',
        },
      );
      await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
        decision: 'approve',
      });
      const again = await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
        decision: 'approve',
      });

      expect(byTeam.statusCode).toBe(403);
      expect(again.statusCode).toBe(409);
      expect(again.json<{ code: string }>().code).toBe('PROFILE_NOT_REVIEWABLE');
    });

    it('does not find the profile of someone without a written profile', async () => {
      const response = await call('POST', `/team-profiles/${randomUUID()}/review`, owner, {
        decision: 'approve',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('certifications', () => {
    const addCertification = (userId: string, name = 'Grado en Ciencias del Deporte') =>
      call('POST', '/team-profiles/me/certifications', userId, {
        name,
        detail: 'Universidad, 2016',
      });

    it('adds a certification, which is not verified yet, and sends the profile back to draft', async () => {
      await publishStaffProfile();

      const response = await addCertification(staff.userId);

      expect(response.statusCode).toBe(201);
      expect(response.json<ProfileBody>()).toMatchObject({
        status: 'draft',
        certifications: [
          { name: 'Grado en Ciencias del Deporte', detail: 'Universidad, 2016', isVerified: false },
        ],
      });
    });

    it('stops at ten', async () => {
      for (let count = 0; count < 10; count += 1) {
        await addCertification(staff.userId, `Titulación ${String(count)}`);
      }

      const eleventh = await addCertification(staff.userId, 'Una más');

      expect(eleventh.statusCode).toBe(409);
      expect(eleventh.json<{ code: string }>().code).toBe('CERTIFICATION_LIMIT_REACHED');
    });

    it('lets the person remove their own and nobody else', async () => {
      const added = (await addCertification(staff.userId)).json<ProfileBody>();
      const certificationId = added.certifications[0]?.id ?? '';

      const byOther = await call(
        'DELETE',
        `/team-profiles/me/certifications/${certificationId}`,
        otherStaff.userId,
      );
      const byOwner = await call(
        'DELETE',
        `/team-profiles/me/certifications/${certificationId}`,
        staff.userId,
      );

      expect(byOther.statusCode).toBe(404);
      expect(byOwner.statusCode).toBe(204);
      expect((await profileOf(staff.userId, staff.membershipId))?.certifications).toEqual([]);
    });

    it('is verified by the administration, not by the team', async () => {
      const added = (await addCertification(staff.userId)).json<ProfileBody>();
      const certificationId = added.certifications[0]?.id ?? '';
      const path = `/team-profiles/${staff.membershipId}/certifications/${certificationId}/verify`;

      expect((await call('POST', path, staff.userId)).statusCode).toBe(403);
      const verified = await call('POST', path, owner);

      expect(verified.json<ProfileBody>().certifications[0]?.isVerified).toBe(true);
    });
  });

  describe('opinions about the team', () => {
    let serviceId: string;
    let bookingId: string;

    async function bookWithStaff(): Promise<string> {
      const slot = firstSlotAtLeast(
        await world.fetchSlots(ana.userId, center.centerId, serviceId),
        MIN_HOURS_AHEAD,
      );
      const response = await world.book(ana.userId, center.centerId, {
        serviceId,
        startsAt: slot.startsAt,
      });
      return response.json<{ id: string }>().id;
    }

    const markAsAttended = (id: string) =>
      inCenter((client) =>
        client.booking.update({ where: { id }, data: { checkedInAt: new Date() } }),
      );
    const review = (userId = ana.userId, rating = 5, comment?: string) =>
      call('POST', `/team-profiles/${staff.membershipId}/reviews`, userId, {
        rating,
        ...(comment && { comment }),
      });

    beforeEach(async () => {
      await world.openAllWeek(owner, center.centerId);
      serviceId = (
        await world.createService(owner, center.centerId, {
          name: 'Sesión personal',
          durationMinutes: 60,
          minNoticeMinutes: 0,
          staffMembershipIds: [staff.membershipId],
        })
      ).id;
      await publishStaffProfile();
      bookingId = await bookWithStaff();
    });

    it('does not allow an opinion about a session that has not happened', async () => {
      const response = await review();

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('REVIEW_NOT_ALLOWED');
    });

    it('waits for the review of the center, then it counts and the person is told', async () => {
      await markAsAttended(bookingId);

      const created = await review(ana.userId, 4, 'Muy buena clase.');
      expect(created.statusCode).toBe(201);
      expect(created.json<ReviewBody>()).toMatchObject({ rating: 4, status: 'pending' });
      expect((await profileOf(ana.userId, staff.membershipId))?.rating).toBeNull();
      pushSender.sent.length = 0;

      const pending = await call('GET', '/staff-reviews/pending', owner);
      const reviewId = pending.json<{ reviews: ReviewBody[] }>().reviews[0]?.id ?? '';
      const moderated = await call('POST', `/staff-reviews/${reviewId}/moderate`, owner, {
        decision: 'approve',
      });

      expect(moderated.json<ReviewBody>().status).toBe('published');
      expect((await profileOf(ana.userId, staff.membershipId))?.rating).toEqual({
        average: 4,
        count: 1,
      });
      expect(pushSender.tokensFor('staff_review_received')).toEqual([TOKEN_STAFF]);
    });

    it('shows only the first name and the initial of the surname of who wrote it', async () => {
      await markAsAttended(bookingId);
      await call('PUT', '/team-settings', owner, { reviewsNeedApproval: false });
      await review(ana.userId, 5, 'Genial.');

      const list = await call('GET', `/team-profiles/${staff.membershipId}/reviews`, ana.userId);

      const [published] = list.json<{ reviews: ReviewBody[] }>().reviews;
      expect(published?.comment).toBe('Genial.');
      expect(published?.authorLabel).not.toContain('@');
      expect(published?.authorLabel.length).toBeLessThanOrEqual(20);
    });

    it('publishes at once when the center does not review opinions', async () => {
      await markAsAttended(bookingId);
      await call('PUT', '/team-settings', owner, { reviewsNeedApproval: false });

      const created = await review();

      expect(created.json<ReviewBody>().status).toBe('published');
      expect(await noticeKindsOf(staff.userId)).toContain('staff_review_received');
    });

    it('allows one opinion per session', async () => {
      await markAsAttended(bookingId);
      await review();

      const again = await review(ana.userId, 1);

      expect(again.statusCode).toBe(409);
    });

    it('does not count a rejected opinion nor a cancelled session', async () => {
      await markAsAttended(bookingId);
      const created = (await review()).json<ReviewBody>();
      await call('POST', `/staff-reviews/${created.id}/moderate`, owner, { decision: 'reject' });

      expect((await profileOf(ana.userId, staff.membershipId))?.rating).toBeNull();
      const again = await call('POST', `/staff-reviews/${created.id}/moderate`, owner, {
        decision: 'approve',
      });
      expect(again.statusCode).toBe(409);
      await inCenter((client) =>
        client.booking.update({ where: { id: bookingId }, data: { status: 'cancelled' } }),
      );
      expect((await review()).statusCode).toBe(409);
    });

    it('accepts ratings from 1 to 5 only, and only from clients', async () => {
      await markAsAttended(bookingId);

      expect((await review(ana.userId, 0)).statusCode).toBe(400);
      expect((await review(ana.userId, 6)).statusCode).toBe(400);
      expect((await review(staff.userId)).statusCode).toBe(403);
      expect((await review(owner)).statusCode).toBe(403);
    });

    it('keeps the moderation for the administration', async () => {
      expect((await call('GET', '/staff-reviews/pending', staff.userId)).statusCode).toBe(403);
      expect((await call('GET', '/staff-reviews/pending', ana.userId)).statusCode).toBe(403);
    });
  });

  describe('the settings of the team', () => {
    it('reads and changes the two switches, one at a time', async () => {
      const initial = await call('GET', '/team-settings', owner);
      const changed = await call('PUT', '/team-settings', owner, { showTeamOnWeb: false });

      expect(initial.json()).toEqual({ showTeamOnWeb: true, reviewsNeedApproval: true });
      expect(changed.json()).toEqual({ showTeamOnWeb: false, reviewsNeedApproval: true });
    });

    it('refuses an empty change and is only for the administration', async () => {
      expect((await call('PUT', '/team-settings', owner, {})).statusCode).toBe(400);
      expect((await call('GET', '/team-settings', staff.userId)).statusCode).toBe(403);
      expect(
        (await call('PUT', '/team-settings', ana.userId, { showTeamOnWeb: false })).statusCode,
      ).toBe(403);
    });
  });
});
