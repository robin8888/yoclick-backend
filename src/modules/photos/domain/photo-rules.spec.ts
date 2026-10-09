import {
  GALLERY_MAX_PHOTOS,
  MAX_PHOTO_SIZE_BYTES,
  buildAvatarKey,
  buildGalleryPhotoKey,
  decideGalleryQuota,
  decidePhotoUpload,
  detectPhotoFormat,
  isGalleryFull,
} from './photo-rules';

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);

describe('detectPhotoFormat', () => {
  it.each([
    ['a JPEG', Buffer.from([...JPEG_HEADER, 0, 0]), 'jpeg'],
    ['a PNG', Buffer.from([...PNG_HEADER, 0, 0]), 'png'],
    ['a WebP', WEBP_HEADER, 'webp'],
    ['a PDF', Buffer.from('%PDF-1.7'), null],
    ['plain text', Buffer.from('hello world, not a picture'), null],
    ['a GIF', Buffer.from('GIF89a......'), null],
    ['a WAV (RIFF but not WebP)', Buffer.from('RIFF$\u0000\u0000\u0000WAVEfmt '), null],
    ['a truncated RIFF', Buffer.from('RIFF'), null],
    ['a truncated PNG signature', Buffer.from(PNG_HEADER.slice(0, 5)), null],
    ['an empty file', Buffer.alloc(0), null],
  ])('says %s is %s', (_name, bytes, expected) => {
    expect(detectPhotoFormat(bytes)).toBe(expected);
  });
});

describe('decidePhotoUpload', () => {
  const jpegOfSize = (size: number): Buffer =>
    Buffer.concat([Buffer.from(JPEG_HEADER), Buffer.alloc(size - JPEG_HEADER.length)]);

  it.each([
    ['a small JPEG', jpegOfSize(100), { kind: 'accepted', format: 'jpeg' }],
    [
      'a JPEG of exactly 5 MB',
      jpegOfSize(MAX_PHOTO_SIZE_BYTES),
      { kind: 'accepted', format: 'jpeg' },
    ],
    ['a JPEG one byte over 5 MB', jpegOfSize(MAX_PHOTO_SIZE_BYTES + 1), { kind: 'too_large' }],
    ['a PDF', Buffer.from('%PDF-1.4 ......'), { kind: 'not_an_image' }],
    [
      'a big file that is not an image',
      Buffer.alloc(MAX_PHOTO_SIZE_BYTES + 10),
      { kind: 'not_an_image' },
    ],
  ])('decides %s', (_name, bytes, expected) => {
    expect(decidePhotoUpload(bytes)).toEqual(expected);
  });
});

describe('photo keys', () => {
  it.each([
    ['jpeg', 'jpg'],
    ['png', 'png'],
    ['webp', 'webp'],
  ] as const)('builds an avatar key for %s with the %s extension', (format, extension) => {
    expect(buildAvatarKey({ userId: 'user-1', photoId: 'photo-1', format })).toBe(
      `photos/avatars/user-1/photo-1.${extension}`,
    );
  });

  it('keeps gallery photos apart by center and member', () => {
    expect(
      buildGalleryPhotoKey({
        centerId: 'center-1',
        membershipId: 'member-1',
        photoId: 'photo-1',
        format: 'png',
      }),
    ).toBe('photos/gallery/center-1/member-1/photo-1.png');
  });
});

describe('isGalleryFull', () => {
  it.each([
    [0, false],
    [GALLERY_MAX_PHOTOS - 1, false],
    [GALLERY_MAX_PHOTOS, true],
    [GALLERY_MAX_PHOTOS + 1, true],
  ])('with %i photos the gallery is full: %s', (photoCount, expected) => {
    expect(isGalleryFull(photoCount)).toBe(expected);
  });
});

describe('decideGalleryQuota', () => {
  const MEGABYTE = 1_048_576n;
  const limit = 100n * MEGABYTE;

  it.each([
    ['an empty gallery space', 0n, MEGABYTE, 'allowed'],
    ['a photo that fits', 50n * MEGABYTE, 5n * MEGABYTE, 'allowed'],
    ['a photo that fills the space exactly', limit - MEGABYTE, MEGABYTE, 'allowed'],
    ['a photo one byte over', limit - MEGABYTE, MEGABYTE + 1n, 'quota_exceeded'],
    ['a full space', limit, 1n, 'quota_exceeded'],
    ['a space already over the limit', limit + MEGABYTE, 1n, 'quota_exceeded'],
  ])('%s', (_caseName, usedBytes, requestedBytes, expected) => {
    expect(decideGalleryQuota({ storageLimitBytes: limit, usedBytes, requestedBytes })).toBe(
      expected,
    );
  });

  it('refuses everything when the plan gives no space', () => {
    expect(decideGalleryQuota({ storageLimitBytes: 0n, usedBytes: 0n, requestedBytes: 1n })).toBe(
      'quota_exceeded',
    );
  });
});
