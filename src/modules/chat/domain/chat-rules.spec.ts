import {
  decideAttachment,
  decideStartConversation,
  isMinor,
  sanitizeAttachmentName,
  type StartConversationFacts,
} from './chat-rules';

const NOW = new Date('2026-10-15T10:00:00Z');

const BASE: StartConversationFacts = {
  actorRole: 'client',
  counterpart: { kind: 'person', role: 'staff' },
  isActorMinor: false,
  isCounterpartMinor: false,
  haveSharedClass: true,
};

describe('isMinor', () => {
  it.each([
    ['no birth date', null, false],
    ['turns 18 tomorrow', new Date('2008-10-16'), true],
    ['turned 18 today', new Date('2008-10-15'), false],
    ['adult', new Date('1990-01-01'), false],
  ])('%s', (_label, birthDate, expected) => {
    expect(isMinor(birthDate, NOW)).toBe(expected);
  });
});

describe('decideStartConversation', () => {
  it.each([
    ['client with a teacher they shared a class with', BASE, 'allowed'],
    ['client with a teacher without a shared class', { ...BASE, haveSharedClass: false }, 'denied'],
    [
      'teacher with a client they shared a class with',
      { ...BASE, actorRole: 'staff', counterpart: { kind: 'person', role: 'client' } },
      'allowed',
    ],
    ['client with the center', { ...BASE, counterpart: { kind: 'center' } }, 'allowed'],
    [
      'teacher with the center',
      { ...BASE, actorRole: 'staff', counterpart: { kind: 'center' } },
      'allowed',
    ],
    [
      'client with another client',
      { ...BASE, counterpart: { kind: 'person', role: 'client' } },
      'denied',
    ],
    ['teacher with another teacher', { ...BASE, actorRole: 'staff' }, 'denied'],
    [
      'owner with a client',
      { ...BASE, actorRole: 'owner', counterpart: { kind: 'person', role: 'client' } },
      'allowed',
    ],
    ['admin with a teacher', { ...BASE, actorRole: 'admin' }, 'allowed'],
    [
      'owner with the center',
      { ...BASE, actorRole: 'owner', counterpart: { kind: 'center' } },
      'denied',
    ],
  ] as const)('%s → %s', (_label, facts, expected) => {
    expect(decideStartConversation(facts).kind).toBe(expected);
  });

  it('denies minors on either side with the guardian code', () => {
    const minorActor = decideStartConversation({
      ...BASE,
      counterpart: { kind: 'center' },
      isActorMinor: true,
    });
    const minorCounterpart = decideStartConversation({
      ...BASE,
      actorRole: 'owner',
      counterpart: { kind: 'person', role: 'client' },
      isCounterpartMinor: true,
    });
    expect(minorActor).toEqual({ kind: 'denied', code: 'CHAT_MINOR_REQUIRES_GUARDIAN' });
    expect(minorCounterpart).toEqual({ kind: 'denied', code: 'CHAT_MINOR_REQUIRES_GUARDIAN' });
  });
});

describe('decideAttachment', () => {
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
  const PDF = Buffer.from('%PDF-1.7 content');

  it('recognises images and PDFs by their bytes', () => {
    expect(decideAttachment(PNG)).toEqual({ kind: 'image', extension: 'png' });
    expect(decideAttachment(PDF)).toEqual({ kind: 'pdf', extension: 'pdf' });
  });

  it('rejects anything else', () => {
    expect(decideAttachment(Buffer.from('MZ executable'))).toEqual({ kind: 'unsupported' });
  });
});

describe('sanitizeAttachmentName', () => {
  it.each([
    ['foto.png', 'foto.png'],
    ['../../etc/passwd', 'passwd'],
    ['a\\b\\informe.pdf', 'informe.pdf'],
    ['   ', 'fallback.bin'],
    [undefined, 'fallback.bin'],
  ])('%s → %s', (raw, expected) => {
    expect(sanitizeAttachmentName(raw, 'fallback.bin')).toBe(expected);
  });
});
