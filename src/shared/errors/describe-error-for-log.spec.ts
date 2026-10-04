import { describeErrorForLog } from './describe-error-for-log';

describe('describeErrorForLog', () => {
  it('keeps the error name and the stack frames, which are enough to find the cause', () => {
    const description = describeErrorForLog(new TypeError('boom'));

    expect(description.errorName).toBe('TypeError');
    expect(description.stackFrames.length).toBeGreaterThan(0);
    expect(description.stackFrames.every((frame) => frame.trimStart().startsWith('at '))).toBe(
      true,
    );
  });

  it('drops the message: database and library errors can embed personal data in it', () => {
    const error = new Error('Unique constraint failed on email = ana@example.com');

    const description = describeErrorForLog(error);

    expect(JSON.stringify(description)).not.toContain('ana@example.com');
  });

  it('keeps a machine-readable code when the error has one, such as a Prisma code', () => {
    const error = Object.assign(new Error('x'), { code: 'P2002' });

    expect(describeErrorForLog(error).errorCode).toBe('P2002');
  });

  it('describes a thrown non-Error value without failing', () => {
    expect(describeErrorForLog('boom')).toEqual({ errorName: 'NonErrorThrown', stackFrames: [] });
  });
});
