import {
  decideVideoUpload,
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
    expect(decideVideoUpload({ storageLimitBytes, usedBytes, requestedBytes })).toBe(expected);
  });

  it('checks the plan before the size', () => {
    expect(
      decideVideoUpload({
        storageLimitBytes: null,
        usedBytes: BigInt(0),
        requestedBytes: BigInt(MAX_VIDEO_SIZE_BYTES) + 1n,
      }),
    ).toBe('not_included');
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
