import {
  decideReportedVideoSize,
  decideVideoUpload,
  isUploadStale,
  MAX_VIDEO_UPLOADS_IN_PROGRESS,
  STALE_UPLOAD_AFTER_MS,
  isVideoVisibleToClients,
  mapBunnyStatusToVideoStatus,
  MAX_VIDEO_SIZE_BYTES,
} from './video-rules';

const MEGABYTE = BigInt(1_048_576);
const GIGABYTE = BigInt(1_073_741_824);

describe('mapBunnyStatusToVideoStatus', () => {
  it.each([
    ['created', 0, 'uploading'],
    ['uploaded', 1, 'processing'],
    ['processing', 2, 'processing'],
    ['transcoding', 3, 'processing'],
    ['finished', 4, 'ready'],
    ['error', 5, 'failed'],
    ['upload failed', 6, 'failed'],
    ['jit segments', 7, 'ready'],
    ['an unknown code', 99, 'processing'],
  ])('maps %s (%i) to %s', (_caseName, bunnyStatusCode, expected) => {
    expect(mapBunnyStatusToVideoStatus(bunnyStatusCode)).toBe(expected);
  });
});

describe('decideVideoUpload', () => {
  it.each([
    ['a plan without video', null, BigInt(0), 10n * MEGABYTE, 'not_included'],
    ['a video that fits', 5n * GIGABYTE, GIGABYTE, 100n * MEGABYTE, 'allowed'],
    ['a video that fills the space exactly', GIGABYTE, GIGABYTE - MEGABYTE, MEGABYTE, 'allowed'],
    ['a video that does not fit', GIGABYTE, GIGABYTE - MEGABYTE, 2n * MEGABYTE, 'quota_exceeded'],
    [
      'a video over the size limit',
      50n * GIGABYTE,
      BigInt(0),
      BigInt(MAX_VIDEO_SIZE_BYTES) + 1n,
      'too_large',
    ],
  ])('%s', (_caseName, storageLimitBytes, usedBytes, requestedBytes, expected) => {
    expect(
      decideVideoUpload({
        storageLimitBytes,
        usedBytes,
        requestedBytes,
        uploadsInProgressCount: 0,
      }),
    ).toBe(expected);
  });

  it.each([
    [0, 'allowed'],
    [MAX_VIDEO_UPLOADS_IN_PROGRESS - 1, 'allowed'],
    [MAX_VIDEO_UPLOADS_IN_PROGRESS, 'too_many_in_progress'],
    [MAX_VIDEO_UPLOADS_IN_PROGRESS + 3, 'too_many_in_progress'],
  ])('with %i uploads in progress it is %s', (uploadsInProgressCount, expected) => {
    expect(
      decideVideoUpload({
        storageLimitBytes: 5n * GIGABYTE,
        usedBytes: BigInt(0),
        requestedBytes: MEGABYTE,
        uploadsInProgressCount,
      }),
    ).toBe(expected);
  });

  it('tells too many uploads before the space is checked', () => {
    expect(
      decideVideoUpload({
        storageLimitBytes: GIGABYTE,
        usedBytes: GIGABYTE,
        requestedBytes: MEGABYTE,
        uploadsInProgressCount: MAX_VIDEO_UPLOADS_IN_PROGRESS,
      }),
    ).toBe('too_many_in_progress');
  });

  it('checks the plan before the size', () => {
    expect(
      decideVideoUpload({
        storageLimitBytes: null,
        usedBytes: BigInt(0),
        requestedBytes: BigInt(MAX_VIDEO_SIZE_BYTES) + 1n,
        uploadsInProgressCount: 0,
      }),
    ).toBe('not_included');
  });
});

describe('decideReportedVideoSize', () => {
  it.each([
    ['a size that fits', 100n * MEGABYTE, GIGABYTE, 0n, 'accepted'],
    ['exactly the maximum size', BigInt(MAX_VIDEO_SIZE_BYTES), 5n * GIGABYTE, 0n, 'accepted'],
    ['over the maximum size', BigInt(MAX_VIDEO_SIZE_BYTES) + 1n, 50n * GIGABYTE, 0n, 'too_large'],
    [
      'filling the space exactly',
      100n * MEGABYTE,
      GIGABYTE,
      GIGABYTE - 100n * MEGABYTE,
      'accepted',
    ],
    [
      'one byte over the space',
      100n * MEGABYTE,
      GIGABYTE,
      GIGABYTE - 100n * MEGABYTE + 1n,
      'quota_exceeded',
    ],
    ['a plan that no longer includes video', 100n * MEGABYTE, null, 10n * GIGABYTE, 'accepted'],
    ['too large even if it would fit', BigInt(MAX_VIDEO_SIZE_BYTES) + 1n, null, 0n, 'too_large'],
  ])('%s', (_caseName, reportedBytes, storageLimitBytes, usedByOtherVideosBytes, expected) => {
    expect(
      decideReportedVideoSize({ reportedBytes, storageLimitBytes, usedByOtherVideosBytes }),
    ).toBe(expected);
  });
});

describe('isUploadStale', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it.each([
    ['just created', 0, false],
    ['almost a day old', STALE_UPLOAD_AFTER_MS - 1, false],
    ['exactly a day old', STALE_UPLOAD_AFTER_MS, false],
    ['a day and a millisecond old', STALE_UPLOAD_AFTER_MS + 1, true],
  ])('%s', (_caseName, ageMs, expected) => {
    expect(isUploadStale(new Date(now.getTime() - ageMs), now)).toBe(expected);
  });
});

describe('isVideoVisibleToClients', () => {
  it.each([
    ['ready and approved', 'ready', 'approved', true],
    ['ready but pending review', 'ready', 'pending', false],
    ['ready but with changes requested', 'ready', 'changes_requested', false],
    ['approved but still processing', 'processing', 'approved', false],
    ['approved but failed', 'failed', 'approved', false],
  ] as const)('%s', (_caseName, status, reviewStatus, expected) => {
    expect(isVideoVisibleToClients({ status, reviewStatus })).toBe(expected);
  });
});
