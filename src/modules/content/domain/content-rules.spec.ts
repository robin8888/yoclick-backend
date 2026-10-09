import {
  MAX_DOCUMENT_SIZE_BYTES,
  buildDocumentKey,
  buildImageKey,
  countPdfPages,
  decideDocumentUpload,
  isPdfFile,
  selectAddedTargets,
} from './content-rules';

const GIGABYTE = 1_073_741_824n;

describe('isPdfFile', () => {
  it.each([
    ['a PDF', '%PDF-1.7\n%âãÏÓ', true],
    ['a PNG', '\u0089PNG\r\n', false],
    ['text that mentions PDF', 'hello %PDF-', false],
    ['an empty file', '', false],
  ])('says %s is %s', (_name, content, expected) => {
    expect(isPdfFile(Buffer.from(content, 'latin1'))).toBe(expected);
  });
});

describe('countPdfPages', () => {
  it('counts page objects and ignores the Pages tree', () => {
    const pdf = '%PDF-1.4 << /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page >>';

    expect(countPdfPages(Buffer.from(pdf, 'latin1'))).toBe(2);
  });

  it('gives null when no page object can be read', () => {
    expect(countPdfPages(Buffer.from('%PDF-1.5 compressed', 'latin1'))).toBeNull();
  });
});

describe('decideDocumentUpload', () => {
  const room = { storageLimitBytes: GIGABYTE, usedBytes: 0n };

  it.each([
    ['fits', { ...room, requestedBytes: 10n }, 'allowed'],
    [
      'is over the size of one file',
      { ...room, requestedBytes: BigInt(MAX_DOCUMENT_SIZE_BYTES) + 1n },
      'too_large',
    ],
    [
      'is exactly the limit of one file',
      { ...room, requestedBytes: BigInt(MAX_DOCUMENT_SIZE_BYTES) },
      'allowed',
    ],
    [
      'does not fit what is left',
      { storageLimitBytes: GIGABYTE, usedBytes: GIGABYTE - 5n, requestedBytes: 6n },
      'quota_exceeded',
    ],
    [
      'fills the space exactly',
      { storageLimitBytes: GIGABYTE, usedBytes: GIGABYTE - 5n, requestedBytes: 5n },
      'allowed',
    ],
  ])('a PDF that %s is %s', (_name, facts, expected) => {
    expect(decideDocumentUpload(facts)).toBe(expected);
  });
});

describe('buildDocumentKey', () => {
  it('keeps the file under its center', () => {
    expect(buildDocumentKey({ centerId: 'center-1', contentId: 'content-1' })).toBe(
      'center-1/content-1.pdf',
    );
  });
});

describe('selectAddedTargets', () => {
  const beginners = { kind: 'level', level: 'beginner' } as const;
  const mornings = { kind: 'group', groupId: 'group-1' } as const;
  const ana = { kind: 'client', membershipId: 'membership-ana' } as const;

  it('keeps only what was not assigned before', () => {
    expect(selectAddedTargets([beginners], [beginners, mornings, ana])).toEqual([mornings, ana]);
  });

  it('gives nothing when the list only shrinks or stays the same', () => {
    expect(selectAddedTargets([beginners, mornings], [beginners])).toEqual([]);
    expect(selectAddedTargets([ana], [ana])).toEqual([]);
  });

  it('tells apart the same kind of target with different values', () => {
    const advanced = { kind: 'level', level: 'advanced' } as const;

    expect(selectAddedTargets([beginners], [advanced])).toEqual([advanced]);
  });
});

describe('buildImageKey', () => {
  it.each([
    ['jpeg', 'jpg'],
    ['png', 'png'],
    ['webp', 'webp'],
  ] as const)('keeps a %s image under the center with the %s extension', (format, extension) => {
    const key = buildImageKey({ centerId: 'center-1', contentId: 'item-1', format });

    expect(key).toBe(`content/images/center-1/item-1.${extension}`);
  });
});
