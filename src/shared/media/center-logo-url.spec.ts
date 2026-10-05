import { buildCenterLogoUrl } from './center-logo-url';

const CENTER_ID = '01a10be3-3b75-73fb-a81c-4935c6a5f0b2';

describe('buildCenterLogoUrl', () => {
  it.each([
    [new Date(1_759_651_200_123), `/v1/centers/${CENTER_ID}/logo?v=1759651200123`],
    [new Date(0), `/v1/centers/${CENTER_ID}/logo?v=0`],
    [null, null],
  ])('maps %p to %p', (logoUpdatedAt, expectedUrl) => {
    expect(buildCenterLogoUrl(CENTER_ID, logoUpdatedAt)).toBe(expectedUrl);
  });

  it('returns a relative path, never an absolute URL', () => {
    expect(buildCenterLogoUrl(CENTER_ID, new Date(1))).toMatch(/^\/v1\//);
  });
});
