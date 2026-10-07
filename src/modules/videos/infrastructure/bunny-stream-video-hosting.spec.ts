import { BunnyStreamVideoHosting } from './bunny-stream-video-hosting';

const SETTINGS = {
  libraryId: '123',
  apiKey: 'api-key',
  tokenKey: 'token-key',
  cdnHostname: 'vz-fake.b-cdn.net',
};

describe('BunnyStreamVideoHosting.signPlayback', () => {
  it('gives plain links when the CDN does not ask for a token', () => {
    const hosting = new BunnyStreamVideoHosting({ ...SETTINGS, isTokenAuthEnabled: false });

    const links = hosting.signPlayback('video-guid');

    expect(links.streamUrl).toBe('https://vz-fake.b-cdn.net/video-guid/playlist.m3u8');
    expect(links.thumbnailUrl).toBe('https://vz-fake.b-cdn.net/video-guid/thumbnail.jpg');
  });

  it('gives signed links, with the token in the path, when the CDN asks for one', () => {
    const hosting = new BunnyStreamVideoHosting({ ...SETTINGS, isTokenAuthEnabled: true });

    const links = hosting.signPlayback('video-guid');

    expect(links.streamUrl).toMatch(
      /^https:\/\/vz-fake\.b-cdn\.net\/bcdn_token=[\w-]+&expires=\d+&token_path=%2Fvideo-guid%2F\/video-guid\/playlist\.m3u8$/,
    );
    expect(links.thumbnailUrl).toContain('/video-guid/thumbnail.jpg');
  });

  it('makes the links expire in the future', () => {
    const hosting = new BunnyStreamVideoHosting({ ...SETTINGS, isTokenAuthEnabled: false });

    expect(hosting.signPlayback('video-guid').expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
