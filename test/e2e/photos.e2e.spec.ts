import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { FILE_STORAGE } from '../../src/modules/content/application/ports/file-storage';
import { FakeFileStorage } from '../../src/modules/content/infrastructure/fake-file-storage';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MEGABYTE = 1_048_576;
const FAKE_HOST = 'https://fake-files.invalid/';
const GALLERY_LIMIT = 6;

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);

const imageOfSize = (header: Buffer, size: number): Buffer =>
  Buffer.concat([header, Buffer.alloc(size - header.length, 1)]);
const smallJpeg = (): Buffer => imageOfSize(JPEG_HEADER, 200);

interface PhotoBody {
  photoUrl: string;
}

interface ProfileBody {
  membershipId: string;
  status: string;
  photoUrl: string | null;
  photos: { id: string; url: string }[];
}

interface ServiceBody {
  staff: { membershipId: string; photoUrl: string | null; photos: { id: string; url: string }[] }[];
}

const CONTENT = {
  headline: 'Entrenadora · 9 años de experiencia',
  bio: 'Ayudo a personas de cualquier nivel a progresar.',
  specialties: ['Fuerza'],
  languages: ['Castellano'],
  hasPublishConsent: true,
};

describe('profile photos', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let center: CreatedTestCenter;
  let owner: string;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let bea: { userId: string; membershipId: string };
  const storage = new FakeFileStorage();

  const url = (path: string): string => `/v1/centers/${center.centerId}${path}`;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    userId: string | undefined,
    body?: object,
  ) => world.call(method, url(path), userId, { centerId: center.centerId, ...(body && { body }) });

  const putMyPhoto = (
    userId: string | undefined,
    bytes: Buffer = smallJpeg(),
    headers: Record<string, string> = { 'content-type': 'image/jpeg' },
  ) => world.call('PUT', '/v1/me/photo', userId, { headers, rawBody: bytes });
  const addGalleryPhoto = (
    userId: string | undefined,
    bytes: Buffer = smallJpeg(),
    centerId: string = center.centerId,
  ) =>
    world.call('POST', `/v1/centers/${centerId}/team-profiles/me/photos`, userId, {
      centerId,
      headers: { 'content-type': 'image/jpeg' },
      rawBody: bytes,
    });
  const getMe = async (userId: string) =>
    (await world.call('GET', '/v1/me', userId)).json<{ photoUrl: string | null }>();
  const setPhotoSpace = (limitBytes: number) =>
    world.tenantPrismaService.runInTenantContext(
      {
        userId: owner,
        centerId: center.centerId,
        membershipId: center.ownerMembershipId,
        role: 'owner',
        permissions: [],
      },
      (client) =>
        client.center.update({
          where: { id: center.centerId },
          data: { photoStorageLimitBytes: BigInt(limitBytes) },
        }),
    );
  const storedKeys = (): string[] => [...storage.files.keys()];

  async function publishStaffProfile(): Promise<void> {
    await call('PUT', '/team-profiles/me', staff.userId, CONTENT);
    await call('POST', '/team-profiles/me/submit', staff.userId);
    await call('POST', `/team-profiles/${staff.membershipId}/review`, owner, {
      decision: 'approve',
    });
  }
  const ownProfile = async (): Promise<ProfileBody> =>
    (await call('GET', `/team-profiles/${staff.membershipId}`, staff.userId)).json<ProfileBody>();
  const servicesSeenBy = async (userId: string): Promise<ServiceBody[]> => {
    const response = await call('GET', '/services', userId);
    return response.json<{ services: ServiceBody[] }>().services;
  };
  const staffEntryIn = (services: ServiceBody[]) =>
    services
      .flatMap(({ staff: entries }) => entries)
      .find((entry) => entry.membershipId === staff.membershipId);

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [{ token: FILE_STORAGE, value: storage }],
    });
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    storage.files.clear();
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
    ana = await world.addMember(center.centerId, 'ana', 'client');
    bea = await world.addMember(center.centerId, 'bea', 'client');
    await world.createService(owner, center.centerId, {
      name: 'Sesión personal',
      durationMinutes: 60,
      staffMembershipIds: [staff.membershipId],
    });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('PUT /me/photo', () => {
    it.each([
      ['a JPEG', JPEG_HEADER],
      ['a PNG', PNG_HEADER],
      ['a WebP', WEBP_HEADER],
    ])(
      'stores %s under the avatars of the user and answers with its link',
      async (_name, header) => {
        const response = await putMyPhoto(ana.userId, imageOfSize(header, 300));

        expect(response.statusCode).toBe(200);
        const { photoUrl } = response.json<PhotoBody>();
        expect(photoUrl.startsWith(FAKE_HOST)).toBe(true);
        expect(storedKeys()).toHaveLength(1);
        expect(storedKeys()[0]).toMatch(new RegExp(`^photos/avatars/${ana.userId}/[0-9a-f-]+\\.`));
        expect(photoUrl).toBe(`${FAKE_HOST}${storedKeys()[0] ?? ''}`);
      },
    );

    it.each([['application/octet-stream'], ['image/png'], ['text/plain'], ['']])(
      'recognizes the image by its bytes whatever type the phone says (%j)',
      async (contentType) => {
        const response = await putMyPhoto(
          ana.userId,
          smallJpeg(),
          contentType === '' ? {} : { 'content-type': contentType },
        );

        expect(response.statusCode).toBe(200);
        expect(storage.files.size).toBe(1);
      },
    );

    it.each([
      ['a PDF', Buffer.from('%PDF-1.4 not a photo at all, only pretending')],
      ['plain text', Buffer.from('hello, I am a photo, really')],
      ['an empty body', Buffer.alloc(0)],
    ])('refuses %s even if it says it is a JPEG', async (_name, bytes) => {
      const response = await putMyPhoto(ana.userId, bytes);

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('PHOTO_NOT_IMAGE');
      expect(storage.files.size).toBe(0);
    });

    it('accepts a photo of exactly 5 MB and refuses one byte more', async () => {
      const exact = await putMyPhoto(ana.userId, imageOfSize(JPEG_HEADER, 5 * MEGABYTE));
      const over = await putMyPhoto(ana.userId, imageOfSize(JPEG_HEADER, 5 * MEGABYTE + 1));

      expect(exact.statusCode).toBe(200);
      expect(over.statusCode).toBe(413);
      expect(over.json<{ code: string }>().code).toBe('PHOTO_TOO_LARGE');
      expect(storage.files.size).toBe(1);
    });

    it('cuts the upload of a body far over the limit', async () => {
      const response = await putMyPhoto(ana.userId, imageOfSize(JPEG_HEADER, 10 * MEGABYTE + 1));

      expect(response.statusCode).toBe(413);
      expect(storage.files.size).toBe(0);
    });

    it('replaces the previous photo and deletes its file', async () => {
      await putMyPhoto(ana.userId);
      const [firstKey] = storedKeys();

      const response = await putMyPhoto(ana.userId, imageOfSize(PNG_HEADER, 300));

      expect(response.statusCode).toBe(200);
      expect(storedKeys()).toHaveLength(1);
      expect(storedKeys()[0]).not.toBe(firstKey);
      expect((await getMe(ana.userId)).photoUrl).toBe(response.json<PhotoBody>().photoUrl);
    });

    it('does not need a center, and works for owner, staff and client alike', async () => {
      for (const userId of [owner, staff.userId, ana.userId]) {
        expect((await putMyPhoto(userId)).statusCode).toBe(200);
      }
      expect(storage.files.size).toBe(3);
    });

    it('is not for anonymous callers', async () => {
      expect((await putMyPhoto(undefined)).statusCode).toBe(401);
      expect((await world.call('DELETE', '/v1/me/photo', undefined)).statusCode).toBe(401);
    });
  });

  describe('DELETE /me/photo', () => {
    it('removes the photo and its file', async () => {
      await putMyPhoto(ana.userId);

      const response = await world.call('DELETE', '/v1/me/photo', ana.userId);

      expect(response.statusCode).toBe(204);
      expect(storage.files.size).toBe(0);
      expect((await getMe(ana.userId)).photoUrl).toBeNull();
    });

    it('is fine when there is no photo', async () => {
      expect((await world.call('DELETE', '/v1/me/photo', ana.userId)).statusCode).toBe(204);
    });
  });

  describe('where the photo shows up', () => {
    it('is in my profile and in my memberships, and null before uploading', async () => {
      expect((await getMe(ana.userId)).photoUrl).toBeNull();
      await putMyPhoto(ana.userId);

      const memberships = await world.call('GET', '/v1/me/memberships', ana.userId);

      expect((await getMe(ana.userId)).photoUrl).toMatch(/^https:\/\/fake-files\.invalid\//);
      expect(
        memberships.json<{ memberships: { photoUrl: string | null }[] }>().memberships[0]?.photoUrl,
      ).toMatch(/^https:\/\/fake-files\.invalid\//);
    });

    it('is in the client list and detail for the team, never for other clients', async () => {
      await putMyPhoto(ana.userId);

      const list = await call('GET', '/clients', owner);
      const detail = await call('GET', `/clients/${ana.membershipId}`, owner);
      const asStaff = await call('GET', '/clients?scope=center', staff.userId);

      const listed = list
        .json<{ clients: { membershipId: string; photoUrl: string | null }[] }>()
        .clients.find(({ membershipId }) => membershipId === ana.membershipId);
      expect(listed?.photoUrl).toMatch(/^https:\/\/fake-files\.invalid\//);
      expect(detail.json<{ photoUrl: string | null }>().photoUrl).toBe(listed?.photoUrl);
      expect(asStaff.statusCode).toBe(200);
      expect((await call('GET', '/clients', bea.userId)).statusCode).toBe(403);
      expect((await call('GET', `/clients/${ana.membershipId}`, bea.userId)).statusCode).toBe(403);
      expect((await call('GET', '/team', bea.userId)).statusCode).toBe(403);
    });

    it('is in the team list with the photo of each member', async () => {
      await putMyPhoto(staff.userId);

      const response = await call('GET', '/team', owner);

      const members = response.json<{
        members: { membershipId: string; photoUrl: string | null }[];
      }>().members;
      expect(
        members.find(({ membershipId }) => membershipId === staff.membershipId)?.photoUrl,
      ).toMatch(/^https:\/\/fake-files\.invalid\//);
      expect(
        members.find(({ membershipId }) => membershipId === center.ownerMembershipId)?.photoUrl,
      ).toBeNull();
    });
  });

  describe('DELETE /centers/:centerId/members/:membershipId/photo', () => {
    it('lets the owner remove the photo of a client', async () => {
      await putMyPhoto(ana.userId);

      const response = await call('DELETE', `/members/${ana.membershipId}/photo`, owner);

      expect(response.statusCode).toBe(204);
      expect(storage.files.size).toBe(0);
      expect((await getMe(ana.userId)).photoUrl).toBeNull();
    });

    it('lets the owner remove the photo of a team member', async () => {
      await putMyPhoto(staff.userId);

      expect((await call('DELETE', `/members/${staff.membershipId}/photo`, owner)).statusCode).toBe(
        204,
      );
      expect(storage.files.size).toBe(0);
    });

    it.each([['staff'], ['client']])('is not allowed to a %s', async (role) => {
      await putMyPhoto(ana.userId);
      const caller = role === 'staff' ? staff.userId : bea.userId;

      const response = await call('DELETE', `/members/${ana.membershipId}/photo`, caller);

      expect(response.statusCode).toBe(403);
      expect(storage.files.size).toBe(1);
    });

    it('answers 404 for someone who is not in the center', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro centro');
      const stranger = await world.addMember(otherCenter.centerId, 'stranger', 'client');
      await putMyPhoto(stranger.userId);

      const response = await call('DELETE', `/members/${stranger.membershipId}/photo`, owner);

      expect(response.statusCode).toBe(404);
      expect(storage.files.size).toBe(1);
    });

    it('answers 404 when the route center is not the one of the header', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro centro');

      const response = await world.call(
        'DELETE',
        `/v1/centers/${otherCenter.centerId}/members/${ana.membershipId}/photo`,
        owner,
        { centerId: center.centerId },
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /team-profiles/me/photos', () => {
    it.each([
      ['a JPEG', JPEG_HEADER],
      ['a PNG', PNG_HEADER],
      ['a WebP', WEBP_HEADER],
    ])('adds %s at the end of the gallery and answers with the profile', async (_name, header) => {
      await addGalleryPhoto(staff.userId);

      const response = await addGalleryPhoto(staff.userId, imageOfSize(header, 300));

      expect(response.statusCode).toBe(201);
      const profile = response.json<ProfileBody>();
      expect(profile.photos).toHaveLength(2);
      expect(profile.photos[1]?.url).toMatch(
        new RegExp(`photos/gallery/${center.centerId}/${staff.membershipId}/`),
      );
      expect(storage.files.size).toBe(2);
    });

    it('keeps the order of upload', async () => {
      const first = (await addGalleryPhoto(staff.userId)).json<ProfileBody>().photos[0];
      const second = (await addGalleryPhoto(staff.userId, imageOfSize(PNG_HEADER, 100)))
        .json<ProfileBody>()
        .photos.map(({ id }) => id);

      expect(second[0]).toBe(first?.id);
      expect(second).toHaveLength(2);
    });

    it('refuses a file that is not an image, whatever its type says', async () => {
      const response = await addGalleryPhoto(staff.userId, Buffer.from('%PDF-1.4 fake'));

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('PHOTO_NOT_IMAGE');
      expect(storage.files.size).toBe(0);
    });

    it('refuses a photo over 5 MB', async () => {
      const response = await addGalleryPhoto(
        staff.userId,
        imageOfSize(JPEG_HEADER, 5 * MEGABYTE + 1),
      );

      expect(response.statusCode).toBe(413);
      expect(response.json<{ code: string }>().code).toBe('PHOTO_TOO_LARGE');
      expect(storage.files.size).toBe(0);
    });

    it('allows six photos and refuses the seventh without keeping its file', async () => {
      for (let count = 0; count < GALLERY_LIMIT; count += 1) {
        expect((await addGalleryPhoto(staff.userId)).statusCode).toBe(201);
      }

      const response = await addGalleryPhoto(staff.userId);

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('PROFILE_PHOTO_LIMIT_REACHED');
      expect(storage.files.size).toBe(GALLERY_LIMIT);
    });

    describe('the photo space of the center', () => {
      const photoOfSize = (size: number): Buffer => imageOfSize(JPEG_HEADER, size);

      it('refuses a photo that does not fit, without keeping its file, and tells the code', async () => {
        await setPhotoSpace(1_000);
        expect((await addGalleryPhoto(staff.userId, photoOfSize(600))).statusCode).toBe(201);

        const response = await addGalleryPhoto(staff.userId, photoOfSize(401));

        expect(response.statusCode).toBe(409);
        expect(response.json<{ code: string }>().code).toBe('PHOTO_QUOTA_EXCEEDED');
        expect(storage.files.size).toBe(1);
      });

      it('lets a photo fill the space exactly', async () => {
        await setPhotoSpace(1_000);
        await addGalleryPhoto(staff.userId, photoOfSize(600));

        expect((await addGalleryPhoto(staff.userId, photoOfSize(400))).statusCode).toBe(201);
      });

      it('shares the space between everyone in the team', async () => {
        const otherStaff = await world.addMember(center.centerId, 'other-staff', 'staff');
        await setPhotoSpace(1_000);
        await addGalleryPhoto(staff.userId, photoOfSize(700));

        const response = await addGalleryPhoto(otherStaff.userId, photoOfSize(400));

        expect(response.statusCode).toBe(409);
        expect(response.json<{ code: string }>().code).toBe('PHOTO_QUOTA_EXCEEDED');
      });

      it('gives the space back when a photo is removed', async () => {
        await setPhotoSpace(1_000);
        const added = (await addGalleryPhoto(staff.userId, photoOfSize(900))).json<ProfileBody>();
        expect((await addGalleryPhoto(staff.userId, photoOfSize(500))).statusCode).toBe(409);

        await call('DELETE', `/team-profiles/me/photos/${added.photos[0]?.id ?? ''}`, staff.userId);

        expect((await addGalleryPhoto(staff.userId, photoOfSize(500))).statusCode).toBe(201);
      });

      it('does not count profile pictures of people against the space', async () => {
        await setPhotoSpace(1_000);
        await putMyPhoto(staff.userId, photoOfSize(900));

        expect((await addGalleryPhoto(staff.userId, photoOfSize(900))).statusCode).toBe(201);
      });

      it('lets two uploads at the same time fill the space only once', async () => {
        const otherStaff = await world.addMember(center.centerId, 'other-staff', 'staff');
        await setPhotoSpace(1_000);

        const responses = await Promise.all([
          addGalleryPhoto(staff.userId, photoOfSize(700)),
          addGalleryPhoto(otherStaff.userId, photoOfSize(700)),
        ]);

        expect(
          responses.map(({ statusCode }) => statusCode).sort((first, second) => first - second),
        ).toEqual([201, 409]);
        expect(storage.files.size).toBe(1);
      });

      it('tells the administration how much of the space is used, in the subscription', async () => {
        await setPhotoSpace(1_000);
        await addGalleryPhoto(staff.userId, photoOfSize(250));

        const subscription = await call('GET', '/subscription', owner);

        expect(subscription.json<{ photoStorage: object }>().photoStorage).toEqual({
          usedBytes: 250,
          limitBytes: 1_000,
        });
      });
    });

    it('sends a published profile back to draft', async () => {
      await publishStaffProfile();
      expect((await ownProfile()).status).toBe('published');

      const response = await addGalleryPhoto(staff.userId);

      expect(response.json<ProfileBody>().status).toBe('draft');
    });

    it('is not for clients, anonymous callers or another center', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro centro');

      expect((await addGalleryPhoto(ana.userId)).statusCode).toBe(403);
      expect((await addGalleryPhoto(undefined)).statusCode).toBe(401);
      const wrongCenter = await world.call(
        'POST',
        `/v1/centers/${otherCenter.centerId}/team-profiles/me/photos`,
        staff.userId,
        { centerId: center.centerId, rawBody: smallJpeg() },
      );
      expect(wrongCenter.statusCode).toBe(404);
      expect(storage.files.size).toBe(0);
    });
  });

  describe('DELETE /team-profiles/me/photos/:photoId', () => {
    it('removes the photo from the gallery and the storage, and the profile goes back to draft', async () => {
      const [photo] = (await addGalleryPhoto(staff.userId)).json<ProfileBody>().photos;
      await publishStaffProfile();

      const response = await call(
        'DELETE',
        `/team-profiles/me/photos/${photo?.id ?? ''}`,
        staff.userId,
      );

      expect(response.statusCode).toBe(204);
      expect(storage.files.size).toBe(0);
      const profile = await ownProfile();
      expect(profile.photos).toEqual([]);
      expect(profile.status).toBe('draft');
    });

    it('does not touch the photo of someone else', async () => {
      const other = await world.addMember(center.centerId, 'other-staff', 'staff');
      const [photo] = (await addGalleryPhoto(other.userId)).json<ProfileBody>().photos;

      const response = await call(
        'DELETE',
        `/team-profiles/me/photos/${photo?.id ?? ''}`,
        staff.userId,
      );

      expect(response.statusCode).toBe(404);
      expect(storage.files.size).toBe(1);
    });

    it('answers 404 for an unknown photo and 403 to a client', async () => {
      const unknownId = '00000000-0000-4000-8000-000000000000';

      expect(
        (await call('DELETE', `/team-profiles/me/photos/${unknownId}`, staff.userId)).statusCode,
      ).toBe(404);
      expect(
        (await call('DELETE', `/team-profiles/me/photos/${unknownId}`, ana.userId)).statusCode,
      ).toBe(403);
    });

    it('frees a place in the gallery', async () => {
      let lastPhotoId = '';
      for (let count = 0; count < GALLERY_LIMIT; count += 1) {
        const photos = (await addGalleryPhoto(staff.userId)).json<ProfileBody>().photos;
        lastPhotoId = photos.at(-1)?.id ?? '';
      }
      await call('DELETE', `/team-profiles/me/photos/${lastPhotoId}`, staff.userId);

      expect((await addGalleryPhoto(staff.userId)).statusCode).toBe(201);
    });
  });

  describe('what each viewer sees of a team member', () => {
    beforeEach(async () => {
      await putMyPhoto(staff.userId);
      await addGalleryPhoto(staff.userId);
    });

    it('shows the photos to the owner and to the member while the profile is a draft', async () => {
      const asOwner = (
        await call('GET', `/team-profiles/${staff.membershipId}`, owner)
      ).json<ProfileBody>();
      const asMember = await ownProfile();

      for (const profile of [asOwner, asMember]) {
        expect(profile.photoUrl).toMatch(/^https:\/\/fake-files\.invalid\//);
        expect(profile.photos).toHaveLength(1);
      }
    });

    it('hides the photos from a client until the profile is published', async () => {
      const detail = await call('GET', `/team-profiles/${staff.membershipId}`, ana.userId);
      expect(detail.statusCode).toBe(200);
      expect(detail.json<ProfileBody>()).toMatchObject({ photoUrl: null, photos: [] });
      const listed = (await call('GET', '/team-profiles', ana.userId)).json<{
        members: ProfileBody[];
      }>();
      const listedStaff = listed.members.find(
        ({ membershipId }) => membershipId === staff.membershipId,
      );
      expect(listedStaff).toMatchObject({ photoUrl: null, photos: [] });
      expect(staffEntryIn(await servicesSeenBy(ana.userId))).toMatchObject({
        photoUrl: null,
        photos: [],
      });

      await publishStaffProfile();
      await addGalleryPhoto(staff.userId);

      expect(staffEntryIn(await servicesSeenBy(ana.userId))).toMatchObject({
        photoUrl: null,
        photos: [],
      });
    });

    it('shows them to a client once it is published, and to the team even before', async () => {
      expect(staffEntryIn(await servicesSeenBy(owner))?.photoUrl).toMatch(
        /^https:\/\/fake-files\.invalid\//,
      );
      expect(staffEntryIn(await servicesSeenBy(owner))?.photos).toHaveLength(1);

      await publishStaffProfile();

      const asClient = (
        await call('GET', `/team-profiles/${staff.membershipId}`, ana.userId)
      ).json<ProfileBody>();
      expect(asClient.photoUrl).toMatch(/^https:\/\/fake-files\.invalid\//);
      expect(asClient.photos).toHaveLength(1);
      const entry = staffEntryIn(await servicesSeenBy(ana.userId));
      expect(entry?.photoUrl).toMatch(/^https:\/\/fake-files\.invalid\//);
      expect(entry?.photos).toHaveLength(1);
    });
  });
});
