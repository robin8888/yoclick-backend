import { addRandomSuffix, generateJoinCode, slugifyCenterName } from './center-identifiers';

const GENERATED_CODES_TO_CHECK = 200;

describe('generateJoinCode', () => {
  it('produces six characters from the unambiguous alphabet', () => {
    for (let attempt = 0; attempt < GENERATED_CODES_TO_CHECK; attempt += 1) {
      expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it('does not repeat itself', () => {
    const codes = new Set(
      Array.from({ length: GENERATED_CODES_TO_CHECK }, () => generateJoinCode()),
    );
    expect(codes.size).toBeGreaterThan(GENERATED_CODES_TO_CHECK - 5);
  });
});

describe('slugifyCenterName', () => {
  it.each([
    ['Studio Norte', 'studio-norte'],
    ['Compás Escuela de Baile', 'compas-escuela-de-baile'],
    ['  ¡Kiné   Lab!  ', 'kine-lab'],
    ['A&B -- Pilates', 'a-b-pilates'],
    ['!!!', 'centro'],
    ['Ñandú', 'nandu'],
  ])('turns %j into %j', (name, expectedSlug) => {
    expect(slugifyCenterName(name)).toBe(expectedSlug);
  });

  it('never ends or starts with a hyphen, even when truncated', () => {
    const slug = slugifyCenterName(`${'a'.repeat(39)} bbbbbbbb`);

    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe('addRandomSuffix', () => {
  it('appends a short suffix that keeps the slug valid', () => {
    expect(addRandomSuffix('studio-norte')).toMatch(/^studio-norte-[a-z0-9]{4}$/);
  });
});
