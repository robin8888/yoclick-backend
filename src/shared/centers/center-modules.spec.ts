import {
  applyCenterModuleChanges,
  listDisabledModulesForWorkMode,
  resolveCenterModules,
} from './center-modules';

describe('center modules', () => {
  it('turns everything on for a center with nothing disabled', () => {
    expect(resolveCenterModules([])).toEqual({
      content: true,
      attendance: true,
      passes: true,
      waitlist: true,
      rooms: true,
    });
  });

  it('turns off only what is stored as disabled and ignores unknown values', () => {
    expect(resolveCenterModules(['passes', 'something-old'])).toEqual({
      content: true,
      attendance: true,
      passes: false,
      waitlist: true,
      rooms: true,
    });
  });

  it.each([
    ['classes', []],
    ['both', []],
    ['appointments', ['content', 'attendance', 'passes', 'waitlist', 'rooms']],
  ] as const)('starts a %s center with %j disabled', (workMode, expected) => {
    expect(listDisabledModulesForWorkMode(workMode)).toEqual(expected);
  });

  it.each([
    ['turns a module off', [], { waitlist: false }, ['waitlist']],
    ['turns a module back on', ['passes', 'waitlist'], { passes: true }, ['waitlist']],
    ['keeps what the change does not mention', ['rooms'], { content: false }, ['content', 'rooms']],
  ] as const)('%s', (_name, current, changes, expected) => {
    expect(applyCenterModuleChanges(current, changes)).toEqual(expected);
  });
});
