import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type PushSendResult,
} from '../../src/modules/push/application/ports/push-sender';
import { VIDEO_HOSTING } from '../../src/modules/videos/application/ports/video-hosting';
import { FakeVideoHosting } from '../../src/modules/videos/infrastructure/fake-video-hosting';
import { type TenantTransactionClient } from '../../src/shared/database/tenant-prisma.service';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MEGABYTE = 1_048_576;
const GIGABYTE = 1024 * MEGABYTE;
const BUNNY_PROCESSING = 2;
const BUNNY_FINISHED = 4;
const TOKEN_OWNER = 'ExponentPushToken[owner-device-0001]';
const TOKEN_STAFF = 'ExponentPushToken[staff-device-0001]';

/** El servicio de vídeo de desarrollo, pero con el estado de procesado a mano. */
class ControlledVideoHosting extends FakeVideoHosting {
  statusCode = BUNNY_FINISHED;

  override fetchProcessingState() {
    return Promise.resolve({
      bunnyStatusCode: this.statusCode,
      sizeBytes: BigInt(50 * MEGABYTE),
      durationSeconds: 42,
    });
  }
}

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

interface VideoBody {
  id: string;
  title: string;
  status: string;
  reviewStatus: string;
  reviewNote: string | null;
  durationSeconds: number | null;
  playback: { streamUrl: string; thumbnailUrl: string; expiresAt: string } | null;
}

interface StartBody {
  video: VideoBody;
  upload: { endpoint: string; headers: Record<string, string>; expiresAt: string };
}

interface TeamProfilesBody {
  members: { membershipId: string; fullName: string; video: VideoBody | null }[];
}

describe('videos', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let center: CreatedTestCenter;
  let owner: string;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  const hosting = new ControlledVideoHosting();
  const pushSender = new RecordingPushSender();

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

  const includeVideoInPlan = (limitBytes: number) =>
    inCenter((client) =>
      client.center.update({
        where: { id: center.centerId },
        data: { videoStorageLimitBytes: BigInt(limitBytes) },
      }),
    );

  const startUpload = (userId: string, body: object = {}) =>
    call('POST', '/videos', userId, {
      title: 'Sentadilla goblet',
      sizeBytes: 50 * MEGABYTE,
      purpose: 'exercise',
      ...body,
    });

  async function startReadyVideo(userId: string, body: object = {}): Promise<VideoBody> {
    const started = await startUpload(userId, body);
    expect(started.statusCode).toBe(201);
    const { video } = started.json<StartBody>();
    hosting.statusCode = BUNNY_FINISHED;
    const refreshed = await call('GET', `/videos/${video.id}`, userId);
    return refreshed.json<VideoBody>();
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
        { token: VIDEO_HOSTING, value: hosting },
        { token: PUSH_SENDER, value: pushSender },
      ],
    });
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    hosting.statusCode = BUNNY_FINISHED;
    hosting.deletedVideoIds.length = 0;
    pushSender.sent.length = 0;
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
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

  describe('the plan', () => {
    it('refuses videos when the plan does not include them, whoever asks', async () => {
      for (const userId of [owner, staff.userId]) {
        const response = await startUpload(userId);

        expect(response.statusCode).toBe(403);
        expect(response.json<{ code: string }>().code).toBe('VIDEO_NOT_INCLUDED');
      }
    });

    it('refuses a video that does not fit in the space of the plan', async () => {
      await includeVideoInPlan(100 * MEGABYTE);

      const response = await startUpload(owner, { sizeBytes: 200 * MEGABYTE });

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('VIDEO_QUOTA_EXCEEDED');
    });

    it('refuses a video over the size limit before looking at the space', async () => {
      await includeVideoInPlan(10 * GIGABYTE);

      const response = await startUpload(owner, { sizeBytes: 600 * MEGABYTE });

      expect(response.statusCode).toBe(400);
    });

    it('counts what is uploaded against the space and tells the owner in the subscription', async () => {
      await includeVideoInPlan(60 * MEGABYTE);
      await startReadyVideo(owner);

      const second = await startUpload(owner);

      expect(second.statusCode).toBe(409);
      const subscription = await call('GET', '/subscription', owner);
      expect(subscription.json()).toMatchObject({
        videoStorageLimitBytes: 60 * MEGABYTE,
        videoStorageUsedBytes: 50 * MEGABYTE,
      });
    });

    it('tells the whole team if the plan includes video, and how much space is left', async () => {
      const without = await call('GET', '/video-plan', staff.userId);
      expect(without.json()).toEqual({ isIncluded: false, limitBytes: null, usedBytes: 0 });

      await includeVideoInPlan(5 * GIGABYTE);
      await startReadyVideo(owner);
      const included = await call('GET', '/video-plan', staff.userId);

      expect(included.json()).toEqual({
        isIncluded: true,
        limitBytes: 5 * GIGABYTE,
        usedBytes: 50 * MEGABYTE,
      });
      expect((await call('GET', '/video-plan', ana.userId)).statusCode).toBe(403);
    });

    it('tells a plan without video as null', async () => {
      const subscription = await call('GET', '/subscription', owner);

      expect(subscription.json()).toMatchObject({
        videoStorageLimitBytes: null,
        videoStorageUsedBytes: 0,
      });
    });
  });

  describe('uploading and processing', () => {
    beforeEach(async () => {
      await includeVideoInPlan(5 * GIGABYTE);
    });

    it('reserves the video and signs a direct upload for the phone', async () => {
      const response = await startUpload(staff.userId);

      expect(response.statusCode).toBe(201);
      const { video, upload } = response.json<StartBody>();
      expect(video).toMatchObject({
        status: 'uploading',
        reviewStatus: 'approved',
        playback: null,
      });
      expect(upload.endpoint).toMatch(/^https:\/\//);
      expect(upload.headers['VideoId']).toBeDefined();
      expect(Date.parse(upload.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('is not for clients', async () => {
      expect((await startUpload(ana.userId)).statusCode).toBe(403);
    });

    it('asks the video service while it processes and gives the playback links once ready', async () => {
      const { video } = (await startUpload(owner)).json<StartBody>();

      hosting.statusCode = BUNNY_PROCESSING;
      const processing = await call('GET', `/videos/${video.id}`, owner);
      expect(processing.json<VideoBody>()).toMatchObject({ status: 'processing', playback: null });

      hosting.statusCode = BUNNY_FINISHED;
      const ready = await call('GET', `/videos/${video.id}`, owner);
      const readyBody = ready.json<VideoBody>();
      expect(readyBody).toMatchObject({ status: 'ready', durationSeconds: 42 });
      expect(readyBody.playback?.streamUrl).toContain('playlist.m3u8');
      expect(Date.parse(readyBody.playback?.expiresAt ?? '')).toBeGreaterThan(Date.now());
    });

    it('does not find a video of another center', async () => {
      const { video } = (await startUpload(owner)).json<StartBody>();
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro Centro');

      const response = await world.call(
        'GET',
        `/v1/centers/${otherCenter.centerId}/videos/${video.id}`,
        otherOwner,
        { centerId: otherCenter.centerId },
      );

      expect(response.statusCode).toBe(404);
    });

    it('lets the team delete their own videos and the administration any of them', async () => {
      const ownerVideo = await startReadyVideo(owner);
      const staffVideo = await startReadyVideo(staff.userId);

      expect((await call('DELETE', `/videos/${ownerVideo.id}`, staff.userId)).statusCode).toBe(403);
      expect((await call('DELETE', `/videos/${staffVideo.id}`, staff.userId)).statusCode).toBe(204);
      expect((await call('DELETE', `/videos/${ownerVideo.id}`, owner)).statusCode).toBe(204);
      expect(hosting.deletedVideoIds).toHaveLength(2);
      expect((await call('GET', `/videos/${ownerVideo.id}`, owner)).statusCode).toBe(404);
    });
  });

  describe('videos in the exercises of a routine', () => {
    const routineWith = (videoId: string | null, userId = owner) =>
      call('POST', '/routines', userId, {
        name: 'Fuerza base',
        items: [{ name: 'Sentadilla goblet', videoId }],
        assignTo: { clientMembershipId: ana.membershipId },
      });

    beforeEach(async () => {
      await includeVideoInPlan(5 * GIGABYTE);
    });

    it('shows the video in the exercise to the team and to the person who receives it', async () => {
      const video = await startReadyVideo(staff.userId);

      const created = await routineWith(video.id);
      expect(created.statusCode).toBe(201);
      const routine = created.json<{ items: { video: VideoBody | null }[] }>();
      expect(routine.items[0]?.video).toMatchObject({ id: video.id, status: 'ready' });
      expect(routine.items[0]?.video?.playback).not.toBeNull();

      const mine = await call('GET', '/my-routines', ana.userId);
      const received = mine.json<{ routines: { items: { video: VideoBody | null }[] }[] }>();
      expect(received.routines[0]?.items[0]?.video?.playback).not.toBeNull();
    });

    it('hides a video that is not ready from the person who receives it', async () => {
      hosting.statusCode = BUNNY_PROCESSING;
      const { video } = (await startUpload(owner)).json<StartBody>();

      const created = await routineWith(video.id);
      expect(created.statusCode).toBe(201);
      const mine = await call('GET', '/my-routines', ana.userId);

      expect(
        mine.json<{ routines: { items: { video: unknown }[] }[] }>().routines[0]?.items[0]?.video,
      ).toBeNull();
    });

    it('keeps the exercise when its video is deleted', async () => {
      const video = await startReadyVideo(owner);
      const routine = (await routineWith(video.id)).json<{ id: string }>();

      await call('DELETE', `/videos/${video.id}`, owner);

      const detail = await call('GET', `/routines/${routine.id}`, owner);
      expect(detail.json<{ items: { name: string; video: unknown }[] }>().items).toEqual([
        { name: 'Sentadilla goblet', category: null, prescription: null, video: null },
      ]);
    });

    it('refuses a video that does not exist in the center', async () => {
      const response = await routineWith(randomUUID());

      expect(response.statusCode).toBe(404);
    });
  });

  describe('the presentation video of the team', () => {
    beforeEach(async () => {
      await includeVideoInPlan(5 * GIGABYTE);
    });

    const teamProfiles = async (userId: string) =>
      (await call('GET', '/team-profiles', userId)).json<TeamProfilesBody>().members;

    it('waits for the center to review what the team uploads, and tells the administration', async () => {
      const video = await startReadyVideo(staff.userId, { purpose: 'profile' });

      expect(video).toMatchObject({ status: 'ready', reviewStatus: 'pending' });
      expect(await noticeKindsOf(owner)).toContain('staff_video_submitted');
      expect(pushSender.tokensFor('staff_video_submitted')).toEqual([TOKEN_OWNER]);
      const forClients = await teamProfiles(ana.userId);
      expect(forClients.every(({ video: profileVideo }) => profileVideo === null)).toBe(true);
      expect(forClients).toHaveLength(0);
    });

    it('publishes what the administration uploads without review', async () => {
      const video = await startReadyVideo(owner, { purpose: 'profile' });

      expect(video.reviewStatus).toBe('approved');
      const forClients = await teamProfiles(ana.userId);
      expect(forClients.map(({ video: profileVideo }) => profileVideo?.id)).toEqual([video.id]);
      expect(forClients[0]?.video?.playback).not.toBeNull();
    });

    it('lets the owner approve it, tells the person, and then the clients see it', async () => {
      const video = await startReadyVideo(staff.userId, { purpose: 'profile' });
      pushSender.sent.length = 0;

      const review = await call('POST', `/videos/${video.id}/review`, owner, {
        decision: 'approve',
      });

      expect(review.statusCode).toBe(200);
      expect(review.json<VideoBody>().reviewStatus).toBe('approved');
      expect(await noticeKindsOf(staff.userId)).toContain('staff_video_reviewed');
      expect(pushSender.tokensFor('staff_video_reviewed')).toEqual([TOKEN_STAFF]);
      const forClients = await teamProfiles(ana.userId);
      expect(forClients.map(({ video: profileVideo }) => profileVideo?.id)).toEqual([video.id]);
    });

    it('lets the owner ask for changes with a note the person can read', async () => {
      const video = await startReadyVideo(staff.userId, { purpose: 'profile' });

      const review = await call('POST', `/videos/${video.id}/review`, owner, {
        decision: 'request_changes',
        note: 'Hay poca luz; grábalo en la sala grande.',
      });

      expect(review.json<VideoBody>()).toMatchObject({
        reviewStatus: 'changes_requested',
        reviewNote: 'Hay poca luz; grábalo en la sala grande.',
      });
      expect(await teamProfiles(ana.userId)).toHaveLength(0);
      const members = await teamProfiles(owner);
      expect(
        members.find(({ membershipId }) => membershipId === staff.membershipId)?.video,
      ).toMatchObject({
        reviewStatus: 'changes_requested',
      });
    });

    it('cannot be reviewed twice, nor by the team', async () => {
      const video = await startReadyVideo(staff.userId, { purpose: 'profile' });

      expect(
        (await call('POST', `/videos/${video.id}/review`, staff.userId, { decision: 'approve' }))
          .statusCode,
      ).toBe(403);
      await call('POST', `/videos/${video.id}/review`, owner, { decision: 'approve' });
      const again = await call('POST', `/videos/${video.id}/review`, owner, {
        decision: 'approve',
      });

      expect(again.statusCode).toBe(409);
      expect(again.json<{ code: string }>().code).toBe('VIDEO_NOT_REVIEWABLE');
    });

    it('replaces the previous presentation video and removes it from the video service', async () => {
      const first = await startReadyVideo(owner, { purpose: 'profile' });

      const second = await startReadyVideo(owner, { purpose: 'profile' });

      expect(second.id).not.toBe(first.id);
      expect(hosting.deletedVideoIds).toHaveLength(1);
      expect((await call('GET', `/videos/${first.id}`, owner)).statusCode).toBe(404);
    });

    it('shows the whole team to the administration, with or without video', async () => {
      await startReadyVideo(staff.userId, { purpose: 'profile' });

      const members = await teamProfiles(owner);

      expect(members.map(({ membershipId }) => membershipId)).toEqual(
        expect.arrayContaining([center.ownerMembershipId, staff.membershipId]),
      );
    });
  });
});
