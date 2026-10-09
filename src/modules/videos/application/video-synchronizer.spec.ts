import { Logger } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { MAX_VIDEO_SIZE_BYTES, STALE_UPLOAD_AFTER_MS } from '../domain/video-rules';
import { FakeVideoHosting } from '../infrastructure/fake-video-hosting';
import {
  type InFlightVideo,
  type ProcessingUpdate,
  type StoredVideo,
  type VideoRepository,
} from './ports/video.repository';
import { VideoSynchronizer } from './video-synchronizer';

const MEGABYTE = 1_048_576n;
const BUNNY_UPLOADING = 0;
const BUNNY_FINISHED = 4;

class ReportingHosting extends FakeVideoHosting {
  bunnyStatusCode = BUNNY_FINISHED;
  reportedBytes = 0n;
  mustFail = false;
  isUnknown = false;

  override fetchProcessingState() {
    if (this.mustFail) return Promise.reject(new Error('hosting is down'));
    if (this.isUnknown) return Promise.resolve(null);
    return Promise.resolve({
      bunnyStatusCode: this.bunnyStatusCode,
      sizeBytes: this.reportedBytes,
      durationSeconds: 30,
    });
  }
}

function buildVideo(overrides: Partial<InFlightVideo> = {}): InFlightVideo {
  return {
    id: 'video-1',
    providerVideoId: 'provider-1',
    title: 'Sentadilla',
    status: 'uploading',
    reviewStatus: 'approved',
    reviewNote: null,
    sizeBytes: 50n * MEGABYTE,
    durationSeconds: null,
    uploadedByMembershipId: 'membership-1',
    createdAt: new Date(),
    ...overrides,
  };
}

/** Solo lo que usa el sincronizador; el resto de la interfaz no se toca. */
class InMemoryVideos implements Pick<
  VideoRepository,
  'readStorageFacts' | 'listInFlight' | 'applyProcessingUpdate'
> {
  readonly updates: { videoId: string; update: ProcessingUpdate }[] = [];
  inFlight: InFlightVideo[] = [];
  storageLimitBytes: bigint | null = 1_000n * MEGABYTE;
  usedBytes = 50n * MEGABYTE;

  readStorageFacts() {
    return Promise.resolve({
      storageLimitBytes: this.storageLimitBytes,
      usedBytes: this.usedBytes,
    });
  }

  listInFlight() {
    return Promise.resolve(this.inFlight);
  }

  applyProcessingUpdate(_actor: ActorContext, videoId: string, update: ProcessingUpdate) {
    this.updates.push({ videoId, update });
    const stored: StoredVideo = { ...buildVideo({ id: videoId }), ...update };
    return Promise.resolve(stored);
  }
}

describe('VideoSynchronizer', () => {
  const actor = { centerId: 'center-1' } as ActorContext;
  let hosting: ReportingHosting;
  let videos: InMemoryVideos;
  let synchronizer: VideoSynchronizer;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    hosting = new ReportingHosting();
    videos = new InMemoryVideos();
    synchronizer = new VideoSynchronizer(videos as unknown as VideoRepository, hosting);
  });

  describe('sync', () => {
    it('keeps the declared size while the hosting does not know the real one', async () => {
      hosting.bunnyStatusCode = BUNNY_UPLOADING;

      await synchronizer.sync(actor, buildVideo());

      expect(videos.updates[0]?.update).toMatchObject({
        status: 'uploading',
        sizeBytes: 50n * MEGABYTE,
      });
      expect(hosting.deletedVideoIds).toEqual([]);
    });

    it('stores the real size when it fits, even if it is bigger than the declared one', async () => {
      hosting.reportedBytes = 120n * MEGABYTE;

      await synchronizer.sync(actor, buildVideo());

      expect(videos.updates[0]?.update).toMatchObject({
        status: 'ready',
        sizeBytes: 120n * MEGABYTE,
      });
      expect(hosting.deletedVideoIds).toEqual([]);
    });

    it('discards a video whose real size is over the maximum, whatever it declared', async () => {
      hosting.reportedBytes = BigInt(MAX_VIDEO_SIZE_BYTES) + 1n;

      await synchronizer.sync(actor, buildVideo({ sizeBytes: MEGABYTE }));

      expect(videos.updates[0]?.update).toEqual({
        status: 'failed',
        sizeBytes: 0n,
        durationSeconds: null,
      });
      expect(hosting.deletedVideoIds).toEqual(['provider-1']);
    });

    it('discards a video whose real size no longer fits in the space of the plan', async () => {
      videos.storageLimitBytes = 200n * MEGABYTE;
      videos.usedBytes = 101n * MEGABYTE + MEGABYTE;
      hosting.reportedBytes = 100n * MEGABYTE;

      await synchronizer.sync(actor, buildVideo({ sizeBytes: MEGABYTE }));

      expect(videos.updates[0]?.update.status).toBe('failed');
      expect(hosting.deletedVideoIds).toEqual(['provider-1']);
    });

    it('does not count its own declared size twice when checking the space', async () => {
      videos.storageLimitBytes = 100n * MEGABYTE;
      videos.usedBytes = 50n * MEGABYTE;
      hosting.reportedBytes = 100n * MEGABYTE;

      await synchronizer.sync(actor, buildVideo());

      expect(videos.updates[0]?.update.status).toBe('ready');
    });

    it('marks as failed, and removes, a video the hosting does not know', async () => {
      hosting.isUnknown = true;

      await synchronizer.sync(actor, buildVideo());

      expect(videos.updates[0]?.update.status).toBe('failed');
      expect(hosting.deletedVideoIds).toEqual(['provider-1']);
    });
  });

  describe('reconcileInFlight', () => {
    it('discards uploads that never finished after a day, without asking the hosting', async () => {
      const abandoned = buildVideo({
        createdAt: new Date(Date.now() - STALE_UPLOAD_AFTER_MS - 1_000),
      });
      videos.inFlight = [abandoned];
      hosting.mustFail = true;

      await synchronizer.reconcileInFlight(actor);

      expect(videos.updates[0]?.update.status).toBe('failed');
      expect(hosting.deletedVideoIds).toEqual(['provider-1']);
    });

    it('keeps a recent upload and syncs it', async () => {
      videos.inFlight = [buildVideo()];
      hosting.reportedBytes = 60n * MEGABYTE;

      await synchronizer.reconcileInFlight(actor);

      expect(videos.updates[0]?.update.sizeBytes).toBe(60n * MEGABYTE);
    });

    it('goes on with the rest if the hosting fails for one of them', async () => {
      videos.inFlight = [buildVideo({ id: 'a' }), buildVideo({ id: 'b' })];
      hosting.mustFail = true;

      await expect(synchronizer.reconcileInFlight(actor)).resolves.toBeUndefined();

      expect(videos.updates).toEqual([]);
    });
  });
});
