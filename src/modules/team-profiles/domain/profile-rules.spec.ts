import {
  canClientsSeeProfile,
  decideNewReviewStatus,
  decideProfileSubmission,
  isBookingEligibleForReview,
  MAX_LIST_ITEM_LENGTH,
  MAX_LIST_ITEMS,
  normalizeTextList,
  summarizeRatings,
} from './profile-rules';

describe('normalizeTextList', () => {
  it.each([
    ['trims every text', ['  Fuerza ', 'Cardio'], ['Fuerza', 'Cardio']],
    ['drops blanks', ['Fuerza', '', '   '], ['Fuerza']],
    [
      'drops repeated texts ignoring case and keeps the first',
      ['Fuerza', 'fuerza', 'FUERZA'],
      ['Fuerza'],
    ],
    ['keeps the order', ['Cardio', 'Fuerza', 'Espalda'], ['Cardio', 'Fuerza', 'Espalda']],
    ['gives an empty list for nothing', [], []],
  ])('%s', (_caseName, texts, expected) => {
    expect(normalizeTextList(texts)).toEqual(expected);
  });

  it('cuts a very long text and a very long list', () => {
    const longText = 'a'.repeat(MAX_LIST_ITEM_LENGTH + 20);
    const manyTexts = Array.from(
      { length: MAX_LIST_ITEMS + 5 },
      (_unused, index) => `Texto ${String(index)}`,
    );

    expect(normalizeTextList([longText])[0]).toHaveLength(MAX_LIST_ITEM_LENGTH);
    expect(normalizeTextList(manyTexts)).toHaveLength(MAX_LIST_ITEMS);
  });
});

describe('decideProfileSubmission', () => {
  const complete = {
    role: 'staff',
    hasPublishConsent: true,
    headline: 'Entrenadora',
    bio: null,
    hasIntroVideo: false,
  };

  it.each([
    ['the team waits for the review', { ...complete }, { kind: 'ready', status: 'pending' }],
    [
      'the owner publishes directly',
      { ...complete, role: 'owner' },
      { kind: 'ready', status: 'published' },
    ],
    [
      'an admin publishes directly',
      { ...complete, role: 'admin' },
      { kind: 'ready', status: 'published' },
    ],
    [
      'no consent to publish',
      { ...complete, hasPublishConsent: false },
      { kind: 'consent_required' },
    ],
    [
      'nothing to show',
      { ...complete, headline: null, bio: null, hasIntroVideo: false },
      { kind: 'empty_profile' },
    ],
    [
      'only a video',
      { ...complete, headline: null, hasIntroVideo: true },
      { kind: 'ready', status: 'pending' },
    ],
    [
      'only a bio',
      { ...complete, headline: null, bio: 'Hola' },
      { kind: 'ready', status: 'pending' },
    ],
  ])('%s', (_caseName, facts, expected) => {
    expect(decideProfileSubmission(facts)).toEqual(expected);
  });

  it('asks for the consent before saying the profile is empty', () => {
    expect(
      decideProfileSubmission({ ...complete, hasPublishConsent: false, headline: null }),
    ).toEqual({ kind: 'consent_required' });
  });
});

describe('canClientsSeeProfile', () => {
  it.each([
    ['published', 'published', true],
    ['draft', 'draft', false],
    ['pending', 'pending', false],
    ['with changes requested', 'changes_requested', false],
  ] as const)('%s', (_caseName, status, isVisible) => {
    expect(canClientsSeeProfile(status)).toBe(isVisible);
  });
});

describe('summarizeRatings', () => {
  it.each([
    ['no opinions', [], null],
    ['one opinion', [5], { average: 5, count: 1 }],
    ['an average rounded to one decimal', [5, 5, 4], { average: 4.7, count: 3 }],
    ['an exact average', [4, 5], { average: 4.5, count: 2 }],
    ['low ratings', [1, 2], { average: 1.5, count: 2 }],
  ])('%s', (_caseName, ratings, expected) => {
    expect(summarizeRatings(ratings)).toEqual(expected);
  });
});

describe('isBookingEligibleForReview', () => {
  const moment = new Date('2026-10-07T10:00:00.000Z');

  it.each([
    ['arrived (QR scanned)', { status: 'confirmed', checkedInAt: moment, endedAt: null }, true],
    ['the session was ended', { status: 'confirmed', checkedInAt: null, endedAt: moment }, true],
    ['nothing happened yet', { status: 'confirmed', checkedInAt: null, endedAt: null }, false],
    [
      'cancelled even if it has a date',
      { status: 'cancelled', checkedInAt: moment, endedAt: null },
      false,
    ],
  ])('%s', (_caseName, booking, isEligible) => {
    expect(isBookingEligibleForReview(booking)).toBe(isEligible);
  });
});

describe('decideNewReviewStatus', () => {
  it('waits for the center when it reviews opinions, and publishes at once when it does not', () => {
    expect(decideNewReviewStatus(true)).toBe('pending');
    expect(decideNewReviewStatus(false)).toBe('published');
  });
});
