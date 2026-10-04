import { DomainError } from '../errors/domain-error';
import { assertIfMatchPrecondition, buildEtag } from './etag';

const SERVICE = { id: 'service-1', updatedAt: new Date('2026-10-04T10:00:00.000Z') };

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('buildEtag', () => {
  it('is a weak validator, stable for the same resource version', () => {
    expect(buildEtag(SERVICE)).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
    expect(buildEtag(SERVICE)).toBe(buildEtag({ ...SERVICE }));
  });

  it('changes when the resource is updated', () => {
    const edited = { ...SERVICE, updatedAt: new Date('2026-10-04T10:00:00.001Z') };

    expect(buildEtag(edited)).not.toBe(buildEtag(SERVICE));
  });

  it('differs between resources with the same timestamp', () => {
    expect(buildEtag({ ...SERVICE, id: 'service-2' })).not.toBe(buildEtag(SERVICE));
  });
});

describe('assertIfMatchPrecondition', () => {
  const currentEtag = buildEtag(SERVICE);

  it('passes when the client holds the current version', () => {
    expect(() => {
      assertIfMatchPrecondition(currentEtag, currentEtag);
    }).not.toThrow();
  });

  it('passes when the current version is among several the client listed', () => {
    expect(() => {
      assertIfMatchPrecondition(`W/"stale", ${currentEtag}`, currentEtag);
    }).not.toThrow();
  });

  it('passes for the wildcard, which means "any existing version"', () => {
    expect(() => {
      assertIfMatchPrecondition('*', currentEtag);
    }).not.toThrow();
  });

  it('answers 428 PRECONDITION_REQUIRED when the client sent no If-Match', () => {
    const error = captureError(() => {
      assertIfMatchPrecondition(undefined, currentEtag);
    });

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'PRECONDITION_REQUIRED', httpStatus: 428 });
  });

  it('answers 412 PRECONDITION_FAILED when someone changed the resource meanwhile', () => {
    const error = captureError(() => {
      assertIfMatchPrecondition('W/"stale"', currentEtag);
    });

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', httpStatus: 412 });
  });
});
