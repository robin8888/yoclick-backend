import { MAX_LOGO_BYTES, type LogoContentType, validateLogoUpload } from './center-logo-image';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const WAVE_HEADER = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45];
const SMALL_PADDING_BYTES = 8;

function toBase64(header: readonly number[], totalBytes = header.length + SMALL_PADDING_BYTES) {
  const bytes = Buffer.alloc(totalBytes);
  bytes.set(header);
  return bytes.toString('base64');
}

function textToBase64(text: string): string {
  return Buffer.from(text).toString('base64');
}

describe('validateLogoUpload', () => {
  it.each<[string, LogoContentType, readonly number[]]>([
    ['a PNG', 'image/png', PNG_HEADER],
    ['a JPEG', 'image/jpeg', JPEG_HEADER],
    ['a WebP', 'image/webp', WEBP_HEADER],
  ])('accepts %s whose bytes match the declared type', (_label, contentType, header) => {
    expect(validateLogoUpload({ contentType, dataBase64: toBase64(header) }).kind).toBe('valid');
  });

  it('accepts a file of exactly the maximum size', () => {
    const dataBase64 = toBase64(PNG_HEADER, MAX_LOGO_BYTES);
    expect(validateLogoUpload({ contentType: 'image/png', dataBase64 }).kind).toBe('valid');
  });

  it('rejects a file one byte over the maximum size as too large', () => {
    const dataBase64 = toBase64(PNG_HEADER, MAX_LOGO_BYTES + 1);
    expect(validateLogoUpload({ contentType: 'image/png', dataBase64 }).kind).toBe('too_large');
  });

  it.each<[string, LogoContentType, string]>([
    ['a JPEG declared as PNG', 'image/png', toBase64(JPEG_HEADER)],
    ['a PNG declared as WebP', 'image/webp', toBase64(PNG_HEADER)],
    ['a RIFF file that is not WebP', 'image/webp', toBase64(WAVE_HEADER)],
    ['an SVG declared as PNG', 'image/png', textToBase64('<svg xmlns="http://x"/>')],
    ['plain text', 'image/jpeg', textToBase64('hello world!')],
    ['an empty payload', 'image/png', ''],
    ['base64 with invalid characters', 'image/png', 'iVBO*Rw0K'],
    ['base64 without padding', 'image/png', 'iVBORw0KGgo'],
    ['base64 with whitespace', 'image/png', 'iVBORw0K Ggo='],
    ['base64 with the url-safe alphabet', 'image/png', 'iVBO_w0K'],
  ])('rejects %s as invalid', (_label, contentType, dataBase64) => {
    expect(validateLogoUpload({ contentType, dataBase64 }).kind).toBe('invalid');
  });

  it('returns the decoded bytes of a valid image', () => {
    const validation = validateLogoUpload({
      contentType: 'image/png',
      dataBase64: toBase64(PNG_HEADER),
    });
    expect(validation.kind === 'valid' && validation.bytes.subarray(0, 8)).toEqual(
      Buffer.from(PNG_HEADER),
    );
  });
});
