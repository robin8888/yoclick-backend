import { z } from 'zod';
import { DomainError } from '../errors/domain-error';
import { decodeCursor, encodeCursor } from './cursor';

const positionSchema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });
const SAMPLE_POSITION = {
  createdAt: '2026-10-04T10:30:00.000Z',
  id: '01a10685-b683-70b8-bc14-b2fed580d44c',
};

describe('cursor', () => {
  it('round-trips a keyset position', () => {
    const cursor = encodeCursor(SAMPLE_POSITION);

    expect(decodeCursor(cursor, positionSchema)).toEqual(SAMPLE_POSITION);
  });

  it('is URL-safe so it can travel in a query string', () => {
    expect(encodeCursor(SAMPLE_POSITION)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['not base64 json', '!!!not-a-cursor!!!'],
    ['valid base64 but not json', Buffer.from('plain text').toString('base64url')],
    ['json with the wrong shape', Buffer.from('{"foo":1}').toString('base64url')],
    ['json with an extra key', encodeCursor({ ...SAMPLE_POSITION, role: 'admin' })],
    ['an empty string', ''],
  ])('rejects %s with a 400 domain error', (_description, tamperedCursor) => {
    expect(() => decodeCursor(tamperedCursor, positionSchema)).toThrow(DomainError);
    try {
      decodeCursor(tamperedCursor, positionSchema);
    } catch (error) {
      expect(error).toMatchObject({ code: 'BAD_REQUEST', httpStatus: 400 });
    }
  });

  it('rejects an oversized cursor before trying to parse it (SEC-50)', () => {
    const oversizedCursor = 'A'.repeat(2_000);

    expect(() => decodeCursor(oversizedCursor, positionSchema)).toThrow(DomainError);
  });
});
