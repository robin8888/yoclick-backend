import { createHash } from 'node:crypto';
import { signCdnDirectoryUrl, signTusUpload, toUnixSeconds } from './bunny-signatures';

describe('toUnixSeconds', () => {
  it('drops the milliseconds', () => {
    expect(toUnixSeconds(new Date('2026-10-07T10:00:00.999Z'))).toBe(1_791_367_200);
  });
});

describe('signTusUpload', () => {
  it('hashes library, key, expiration and video in that order', () => {
    const signature = signTusUpload({
      libraryId: '123',
      apiKey: 'secret-key',
      expiresAtUnixSeconds: 1_800_000_000,
      providerVideoId: 'video-guid',
    });

    expect(signature).toBe(
      createHash('sha256').update('123secret-key1800000000video-guid').digest('hex'),
    );
  });

  it('changes when any part changes', () => {
    const base = {
      libraryId: '123',
      apiKey: 'secret-key',
      expiresAtUnixSeconds: 1_800_000_000,
      providerVideoId: 'video-guid',
    };

    expect(signTusUpload({ ...base, providerVideoId: 'other' })).not.toBe(signTusUpload(base));
    expect(signTusUpload({ ...base, expiresAtUnixSeconds: 1_800_000_001 })).not.toBe(
      signTusUpload(base),
    );
  });
});

describe('signCdnDirectoryUrl', () => {
  const request = {
    hostname: 'vz-fake.b-cdn.net',
    tokenKey: 'token-key',
    directoryPath: '/video-guid/',
    filePath: '/video-guid/playlist.m3u8',
    expiresAtUnixSeconds: 1_800_000_000,
  };

  it('puts the token, the expiration and the directory in the path, before the file', () => {
    const url = signCdnDirectoryUrl(request);

    expect(url).toMatch(
      /^https:\/\/vz-fake\.b-cdn\.net\/bcdn_token=[\w-]+&expires=1800000000&token_path=%2Fvideo-guid%2F\/video-guid\/playlist\.m3u8$/,
    );
  });

  it('signs the directory with the key, the path, the expiration and the token_path parameter', () => {
    const expectedToken = createHash('sha256')
      .update('token-key/video-guid/1800000000token_path=/video-guid/')
      .digest('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');

    expect(signCdnDirectoryUrl(request)).toContain(`bcdn_token=${expectedToken}&`);
  });

  it('gives the thumbnail the same signature as the playlist, since they share the directory', () => {
    const playlist = signCdnDirectoryUrl(request);
    const thumbnail = signCdnDirectoryUrl({ ...request, filePath: '/video-guid/thumbnail.jpg' });

    expect(thumbnail.replace('thumbnail.jpg', 'playlist.m3u8')).toBe(playlist);
  });

  it('uses a different token when the key is different', () => {
    expect(signCdnDirectoryUrl({ ...request, tokenKey: 'another-key' })).not.toBe(
      signCdnDirectoryUrl(request),
    );
  });
});
