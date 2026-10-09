import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { FILE_STORAGE } from '../../src/modules/content/application/ports/file-storage';
import { FakeFileStorage } from '../../src/modules/content/infrastructure/fake-file-storage';
import { VIDEO_HOSTING } from '../../src/modules/videos/application/ports/video-hosting';
import { FakeVideoHosting } from '../../src/modules/videos/infrastructure/fake-video-hosting';
import { type TenantTransactionClient } from '../../src/shared/database/tenant-prisma.service';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MEGABYTE = 1_048_576;
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);
const imageOfSize = (header: Buffer, size: number): Buffer =>
  Buffer.concat([header, Buffer.alloc(size - header.length)]);
const SAMPLE_PDF = Buffer.from(
  '%PDF-1.4\n<< /Type /Pages >> << /Type /Page >> << /Type /Page >>\n',
);

interface ContentBody {
  id: string;
  kind: 'video' | 'pdf' | 'image';
  title: string;
  need: string | null;
  level: string | null;
  sizeBytes: number;
  pageCount: number | null;
  isReady: boolean;
  thumbnailUrl: string | null;
  assignments: { id: string; level: string | null; groupId: string | null; label: string | null }[];
}

interface DetailBody extends ContentBody {
  document: { url: string } | null;
  image: { url: string } | null;
  playback: { streamUrl: string } | null;
}

describe('content library', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let center: CreatedTestCenter;
  let owner: string;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let bea: { userId: string; membershipId: string };
  const storage = new FakeFileStorage();
  const hosting = new FakeVideoHosting();

  const url = (path: string): string => `/v1/centers/${center.centerId}${path}`;
  const call = (
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT',
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

  const uploadPdf = (
    userId: string,
    options: { bytes?: Buffer; query?: string; centerId?: string } = {},
  ) =>
    world.call(
      'POST',
      `/v1/centers/${options.centerId ?? center.centerId}/content/documents?${options.query ?? 'title=Guía%20de%20calentamiento&need=Técnica'}`,
      userId,
      {
        centerId: options.centerId ?? center.centerId,
        headers: { 'content-type': 'application/pdf' },
        rawBody: options.bytes ?? SAMPLE_PDF,
      },
    );

  const uploadImage = (
    userId: string,
    options: { bytes?: Buffer; query?: string; contentType?: string } = {},
  ) =>
    world.call(
      'POST',
      `/v1/centers/${center.centerId}/content/images?${options.query ?? 'title=Postura%20correcta&need=Técnica'}`,
      userId,
      {
        centerId: center.centerId,
        headers: { 'content-type': options.contentType ?? 'application/octet-stream' },
        rawBody: options.bytes ?? imageOfSize(JPEG_HEADER, 200),
      },
    );

  async function addImage(query?: string): Promise<ContentBody> {
    const response = await uploadImage(owner, query === undefined ? {} : { query });
    expect(response.statusCode).toBe(201);
    return response.json<ContentBody>();
  }

  async function addPdf(query?: string): Promise<ContentBody> {
    const response = await uploadPdf(owner, query === undefined ? {} : { query });
    expect(response.statusCode).toBe(201);
    return response.json<ContentBody>();
  }

  const assign = (contentId: string, targets: object[]) =>
    call('PUT', `/content/${contentId}/assignments`, owner, { targets });

  const callMyContent = (path: string, userId: string) =>
    world.call('GET', `/v1/centers/${center.centerId}/my-content${path}`, userId, {
      centerId: center.centerId,
    });

  const myContentIds = async (userId: string): Promise<string[]> => {
    const response = await callMyContent('', userId);
    return response.json<{ items: { id: string }[] }>().items.map(({ id }) => id);
  };

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [
        { token: FILE_STORAGE, value: storage },
        { token: VIDEO_HOSTING, value: hosting },
      ],
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
  });

  afterAll(async () => {
    await application.close();
  });

  describe('adding a PDF', () => {
    it('stores the file under the center and lists it unassigned with its size and pages', async () => {
      const content = await addPdf();

      expect(content).toMatchObject({
        kind: 'pdf',
        title: 'Guía de calentamiento',
        need: 'Técnica',
        sizeBytes: SAMPLE_PDF.length,
        pageCount: 2,
        isReady: true,
        assignments: [],
      });
      expect([...storage.files.keys()]).toEqual([`${center.centerId}/${content.id}.pdf`]);
    });

    it.each([['application/octet-stream'], ['application/pdf; charset=utf-8'], ['']])(
      'accepts the PDF whatever type the phone says it is (%j)',
      async (contentType) => {
        const response = await world.call(
          'POST',
          `/v1/centers/${center.centerId}/content/documents?title=Guia`,
          owner,
          {
            centerId: center.centerId,
            headers: contentType === '' ? {} : { 'content-type': contentType },
            rawBody: SAMPLE_PDF,
          },
        );

        expect(response.statusCode).toBe(201);
        expect(storage.files.size).toBe(1);
      },
    );

    it('refuses a file that is not a PDF, whatever its content type says', async () => {
      const response = await uploadPdf(owner, { bytes: Buffer.from('not a pdf at all') });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('DOCUMENT_NOT_PDF');
      expect(storage.files.size).toBe(0);
    });

    it('refuses a PDF over 50 MB', async () => {
      const bytes = Buffer.concat([SAMPLE_PDF, Buffer.alloc(50 * MEGABYTE)]);

      const response = await uploadPdf(owner, { bytes });

      expect(response.statusCode).toBe(413);
      expect(storage.files.size).toBe(0);
    });

    it('refuses a PDF that does not fit in the space of the plan', async () => {
      await inCenter((client) =>
        client.center.update({
          where: { id: center.centerId },
          data: { documentStorageLimitBytes: BigInt(SAMPLE_PDF.length + 10) },
        }),
      );
      await addPdf();

      const response = await uploadPdf(owner);

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('DOCUMENT_QUOTA_EXCEEDED');
      expect(storage.files.size).toBe(1);
    });

    it('reports the space used and the limit of the plan', async () => {
      await addPdf();

      const response = await call('GET', '/content', owner);

      expect(response.json<{ storage: object }>().storage).toEqual({
        limitBytes: 1024 * MEGABYTE,
        usedBytes: SAMPLE_PDF.length,
      });
    });

    it.each([['staff'], ['client']])('is not allowed to a %s', async (role) => {
      const userId = role === 'staff' ? staff.userId : ana.userId;

      const response = await uploadPdf(userId);

      expect(response.statusCode).toBe(403);
      expect(storage.files.size).toBe(0);
    });
  });

  describe('adding a video', () => {
    async function reserveVideo(): Promise<string> {
      const response = await call('POST', '/videos', owner, {
        title: 'Clase grabada',
        sizeBytes: MEGABYTE,
        purpose: 'exercise',
      });
      if (response.statusCode !== 201) {
        await inCenter((client) =>
          client.center.update({
            where: { id: center.centerId },
            data: { videoStorageLimitBytes: BigInt(10 * 1024 * MEGABYTE) },
          }),
        );
        return reserveVideo();
      }
      return response.json<{ video: { id: string } }>().video.id;
    }

    it('puts a reserved video in the library, once', async () => {
      const videoId = await reserveVideo();

      const first = await call('POST', '/content/videos', owner, { videoId, title: 'Clase' });
      const second = await call('POST', '/content/videos', owner, { videoId, title: 'Otra' });

      expect(first.statusCode).toBe(201);
      expect(first.json<ContentBody>()).toMatchObject({ kind: 'video', title: 'Clase' });
      expect(second.statusCode).toBe(409);
      expect(second.json<{ code: string }>().code).toBe('CONTENT_VIDEO_ALREADY_IN_LIBRARY');
    });

    it('does not accept a video that does not exist in the center', async () => {
      const response = await call('POST', '/content/videos', owner, {
        videoId: randomUUID(),
        title: 'Fantasma',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('assigning', () => {
    it('shows a client what is assigned to their level, their group or to them', async () => {
      const group = await call('POST', '/groups', owner, { name: 'Mañanas' });
      const groupId = group.json<{ id: string }>().id;
      await inCenter((client) =>
        Promise.all([
          client.membership.update({
            where: { id: ana.membershipId },
            data: { level: 'beginner' },
          }),
          client.membership.update({ where: { id: bea.membershipId }, data: { groupId } }),
        ]),
      );
      const forLevel = await addPdf('title=Para%20inicio');
      const forGroup = await addPdf('title=Para%20mañanas');
      const forAna = await addPdf('title=Solo%20Ana');
      await addPdf('title=Sin%20asignar');

      await assign(forLevel.id, [{ kind: 'level', level: 'beginner' }]);
      await assign(forGroup.id, [{ kind: 'group', groupId }]);
      await assign(forAna.id, [{ kind: 'client', membershipId: ana.membershipId }]);

      expect(new Set(await myContentIds(ana.userId))).toEqual(new Set([forLevel.id, forAna.id]));
      expect(await myContentIds(bea.userId)).toEqual([forGroup.id]);
    });

    it('replaces the previous assignments and reports who each one is for', async () => {
      const group = await call('POST', '/groups', owner, { name: 'Mañanas' });
      const groupId = group.json<{ id: string }>().id;
      const content = await addPdf();
      await assign(content.id, [{ kind: 'level', level: 'advanced' }]);

      const response = await assign(content.id, [
        { kind: 'group', groupId },
        { kind: 'client', membershipId: ana.membershipId },
        { kind: 'client', membershipId: ana.membershipId },
      ]);

      const { assignments } = response.json<ContentBody>();
      expect(assignments.map(({ level, groupId: assigned }) => ({ level, assigned }))).toEqual([
        { level: null, assigned: groupId },
        { level: null, assigned: null },
      ]);
      expect(assignments[0]?.label).toBe('Mañanas');
      expect(assignments).toHaveLength(2);
    });

    it('stops showing it when it is unassigned', async () => {
      const content = await addPdf();
      await assign(content.id, [{ kind: 'client', membershipId: ana.membershipId }]);

      await assign(content.id, []);

      expect(await myContentIds(ana.userId)).toEqual([]);
    });

    it('refuses a group or a person that is not in the center', async () => {
      const content = await addPdf();

      const response = await assign(content.id, [{ kind: 'group', groupId: randomUUID() }]);

      expect(response.statusCode).toBe(422);
      expect(response.json<{ code: string }>().code).toBe('CONTENT_ASSIGNMENT_INVALID');
    });
  });

  describe('notices and the team', () => {
    const noticesOf = async (userId: string) =>
      (await call('GET', '/notifications', userId)).json<{
        notifications: { kind: string; data: Record<string, string> }[];
      }>().notifications;

    it('tells the client with a notice naming the piece when it is assigned to them', async () => {
      const content = await addPdf('title=Para%20Ana');

      await assign(content.id, [{ kind: 'client', membershipId: ana.membershipId }]);

      expect(await noticesOf(ana.userId)).toMatchObject([
        { kind: 'content_assigned', data: { contentTitle: 'Para Ana' } },
      ]);
      expect(await noticesOf(bea.userId)).toEqual([]);
    });

    it('tells everyone at the assigned level, once, and nobody at other levels', async () => {
      await inCenter((client) =>
        Promise.all([
          client.membership.update({
            where: { id: ana.membershipId },
            data: { level: 'beginner' },
          }),
          client.membership.update({
            where: { id: bea.membershipId },
            data: { level: 'advanced' },
          }),
        ]),
      );
      const content = await addPdf();

      await assign(content.id, [
        { kind: 'level', level: 'beginner' },
        { kind: 'client', membershipId: ana.membershipId },
      ]);

      expect(await noticesOf(ana.userId)).toHaveLength(1);
      expect(await noticesOf(bea.userId)).toEqual([]);
    });

    it('does not tell again the ones who already had it when the list is saved again', async () => {
      const content = await addPdf();
      await assign(content.id, [{ kind: 'client', membershipId: ana.membershipId }]);

      await assign(content.id, [
        { kind: 'client', membershipId: ana.membershipId },
        { kind: 'client', membershipId: bea.membershipId },
      ]);

      expect(await noticesOf(ana.userId)).toHaveLength(1);
      expect(await noticesOf(bea.userId)).toHaveLength(1);
    });

    it('does not tell anyone when it is unassigned', async () => {
      const content = await addPdf();
      await assign(content.id, [{ kind: 'client', membershipId: ana.membershipId }]);

      await assign(content.id, []);

      expect(await noticesOf(ana.userId)).toHaveLength(1);
    });

    it('lets the team see the library and assign a piece, but not upload or delete', async () => {
      const content = await addPdf();

      const library = await call('GET', '/content', staff.userId);
      const assigned = await call('PUT', `/content/${content.id}/assignments`, staff.userId, {
        targets: [{ kind: 'client', membershipId: ana.membershipId }],
      });
      const deleted = await call('DELETE', `/content/${content.id}`, staff.userId);

      expect(library.statusCode).toBe(200);
      expect(assigned.statusCode).toBe(200);
      expect(deleted.statusCode).toBe(403);
      expect(await noticesOf(ana.userId)).toHaveLength(1);
    });

    it('does not let a client assign anything', async () => {
      const content = await addPdf();

      const response = await call('PUT', `/content/${content.id}/assignments`, ana.userId, {
        targets: [{ kind: 'client', membershipId: ana.membershipId }],
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('what a client opens', () => {
    it('gives a signed link to the PDF only to whom it is assigned', async () => {
      const content = await addPdf();
      await assign(content.id, [{ kind: 'client', membershipId: ana.membershipId }]);

      const mine = await callMyContent(`/${content.id}`, ana.userId);
      const notMine = await callMyContent(`/${content.id}`, bea.userId);

      expect(mine.statusCode).toBe(200);
      expect(mine.json<DetailBody>().document?.url).toContain(`${content.id}.pdf`);
      expect(notMine.statusCode).toBe(404);
    });

    it('is not for the team: they manage the library instead', async () => {
      const response = await callMyContent('', staff.userId);

      expect(response.statusCode).toBe(403);
    });
  });

  describe('editing and deleting', () => {
    it('changes the title, the need and the level', async () => {
      const content = await addPdf();

      const response = await call('PATCH', `/content/${content.id}`, owner, {
        title: 'Nuevo título',
        need: null,
        level: 'advanced',
      });

      expect(response.json<ContentBody>()).toMatchObject({
        title: 'Nuevo título',
        need: null,
        level: 'advanced',
      });
    });

    it('deletes the piece and frees its file', async () => {
      const content = await addPdf();
      await assign(content.id, [{ kind: 'client', membershipId: ana.membershipId }]);

      const response = await call('DELETE', `/content/${content.id}`, owner);

      expect(response.statusCode).toBe(204);
      expect(storage.files.size).toBe(0);
      expect(await myContentIds(ana.userId)).toEqual([]);
      expect((await call('DELETE', `/content/${content.id}`, owner)).statusCode).toBe(404);
    });

    it('does not touch another center library', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro centro');
      const content = await addPdf();

      const response = await world.call(
        'DELETE',
        `/v1/centers/${otherCenter.centerId}/content/${content.id}`,
        otherOwner,
        { centerId: otherCenter.centerId },
      );

      expect(response.statusCode).toBe(404);
      expect(storage.files.size).toBe(1);
    });
  });

  describe('images', () => {
    it.each([
      ['JPEG', JPEG_HEADER, 'jpg'],
      ['PNG', PNG_HEADER, 'png'],
      ['WebP', WEBP_HEADER, 'webp'],
    ])(
      'stores a %s under the center and lists it as an image',
      async (_name, header, extension) => {
        const response = await uploadImage(owner, { bytes: imageOfSize(header, 300) });

        expect(response.statusCode).toBe(201);
        const content = response.json<ContentBody>();
        expect(content).toMatchObject({
          kind: 'image',
          title: 'Postura correcta',
          need: 'Técnica',
          sizeBytes: 300,
          pageCount: null,
          isReady: true,
        });
        expect([...storage.files.keys()]).toEqual([
          `content/images/${center.centerId}/${content.id}.${extension}`,
        ]);
      },
    );

    it.each([
      ['a PDF', SAMPLE_PDF],
      ['plain text', Buffer.from('not an image at all')],
    ])('refuses %s sent as an image, whatever its content type says', async (_name, bytes) => {
      const response = await uploadImage(owner, { bytes, contentType: 'image/png' });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('PHOTO_NOT_IMAGE');
      expect(storage.files.size).toBe(0);
    });

    it('refuses an image over 5 MB and accepts one of exactly 5 MB', async () => {
      const tooLarge = await uploadImage(owner, {
        bytes: imageOfSize(JPEG_HEADER, 5 * MEGABYTE + 1),
      });
      const limit = await uploadImage(owner, { bytes: imageOfSize(JPEG_HEADER, 5 * MEGABYTE) });

      expect(tooLarge.statusCode).toBe(413);
      expect(tooLarge.json<{ code: string }>().code).toBe('PHOTO_TOO_LARGE');
      expect(limit.statusCode).toBe(201);
      expect(storage.files.size).toBe(1);
    });

    it('needs a title', async () => {
      const response = await uploadImage(owner, { query: 'need=Técnica' });

      expect(response.statusCode).toBe(400);
    });

    it('shares the document space of the plan with the PDFs', async () => {
      await inCenter((client) =>
        client.center.update({
          where: { id: center.centerId },
          data: { documentStorageLimitBytes: BigInt(SAMPLE_PDF.length + 250) },
        }),
      );
      await addPdf();

      const response = await uploadImage(owner, { bytes: imageOfSize(JPEG_HEADER, 300) });
      const library = (await call('GET', '/content', owner)).json<{
        storage: { usedBytes: number };
      }>();

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('DOCUMENT_QUOTA_EXCEEDED');
      expect(library.storage.usedBytes).toBe(SAMPLE_PDF.length);
      expect(storage.files.size).toBe(1);
    });

    it('counts the images already stored when reporting the space used', async () => {
      await addImage();

      const library = await call('GET', '/content', owner);

      expect(library.json<{ storage: { usedBytes: number } }>().storage.usedBytes).toBe(200);
    });

    it('shows a client the image only when assigned by level, group or directly, with a signed link', async () => {
      const group = await call('POST', '/groups', owner, { name: 'Mañanas' });
      const groupId = group.json<{ id: string }>().id;
      await inCenter((client) =>
        Promise.all([
          client.membership.update({
            where: { id: ana.membershipId },
            data: { level: 'beginner' },
          }),
          client.membership.update({ where: { id: bea.membershipId }, data: { groupId } }),
        ]),
      );
      const forLevel = await addImage('title=Nivel');
      const forGroup = await addImage('title=Grupo');
      const forBea = await addImage('title=Directa');
      const unassigned = await addImage('title=Sin%20asignar');

      await assign(forLevel.id, [{ kind: 'level', level: 'beginner' }]);
      await assign(forGroup.id, [{ kind: 'group', groupId }]);
      await assign(forBea.id, [{ kind: 'client', membershipId: bea.membershipId }]);

      expect(await myContentIds(ana.userId)).toEqual([forLevel.id]);
      expect(new Set(await myContentIds(bea.userId))).toEqual(new Set([forGroup.id, forBea.id]));
      const mine = await callMyContent(`/${forLevel.id}`, ana.userId);
      expect(mine.json<DetailBody>()).toMatchObject({ kind: 'image', document: null });
      expect(mine.json<DetailBody>().image?.url).toContain(`${forLevel.id}.jpg`);
      const myList = await callMyContent('', ana.userId);
      expect(myList.json<{ items: ContentBody[] }>().items[0]?.thumbnailUrl).toBe(
        mine.json<DetailBody>().image?.url,
      );
      const library = await call('GET', '/content', owner);
      const listed = library
        .json<{ items: ContentBody[] }>()
        .items.find(({ id }) => id === forLevel.id);
      expect(listed?.thumbnailUrl).toContain(`${forLevel.id}.jpg`);
      expect((await callMyContent(`/${unassigned.id}`, ana.userId)).statusCode).toBe(404);
      expect((await callMyContent(`/${forLevel.id}`, bea.userId)).statusCode).toBe(404);
    });

    it('lets the staff assign it, notifying the client, but not upload, edit or delete it', async () => {
      const image = await addImage('title=Para%20Ana');

      const assigned = await call('PUT', `/content/${image.id}/assignments`, staff.userId, {
        targets: [{ kind: 'client', membershipId: ana.membershipId }],
      });
      const uploaded = await uploadImage(staff.userId);
      const renamed = await call('PATCH', `/content/${image.id}`, staff.userId, { title: 'X' });
      const deleted = await call('DELETE', `/content/${image.id}`, staff.userId);
      const notices = (await call('GET', '/notifications', ana.userId)).json<{
        notifications: { kind: string; data: Record<string, string> }[];
      }>().notifications;

      expect(assigned.statusCode).toBe(200);
      expect([uploaded.statusCode, renamed.statusCode, deleted.statusCode]).toEqual([
        403, 403, 403,
      ]);
      expect(notices).toMatchObject([
        { kind: 'content_assigned', data: { contentTitle: 'Para Ana' } },
      ]);
    });

    it('does not let a client upload an image', async () => {
      const response = await uploadImage(ana.userId);

      expect(response.statusCode).toBe(403);
      expect(storage.files.size).toBe(0);
    });

    it('lets the owner rename and label it, and removes the file when deleted', async () => {
      const image = await addImage();

      const edited = await call('PATCH', `/content/${image.id}`, owner, {
        title: 'Nueva foto',
        need: 'Fuerza',
        level: 'advanced',
      });
      const deleted = await call('DELETE', `/content/${image.id}`, owner);

      expect(edited.json<ContentBody>()).toMatchObject({
        kind: 'image',
        title: 'Nueva foto',
        need: 'Fuerza',
        level: 'advanced',
      });
      expect(deleted.statusCode).toBe(204);
      expect(storage.files.size).toBe(0);
    });
  });
});
