import { areIntervalsConsistent, isValidTimeOfDay, isValidTimeZone } from './opening-hours';

describe('isValidTimeOfDay', () => {
  it.each(['00:00', '09:30', '23:59'])('accepts %s', (time) => {
    expect(isValidTimeOfDay(time)).toBe(true);
  });

  it.each(['24:00', '9:30', '12:60', '12-30', '', '12:30:00'])('rejects %j', (time) => {
    expect(isValidTimeOfDay(time)).toBe(false);
  });
});

describe('areIntervalsConsistent', () => {
  it.each([
    ['no intervals (closed)', []],
    ['one interval', [{ opensAt: '09:00', closesAt: '14:00' }]],
    [
      'split shift, given out of order',
      [
        { opensAt: '16:00', closesAt: '20:00' },
        { opensAt: '09:00', closesAt: '14:00' },
      ],
    ],
    [
      'back-to-back intervals',
      [
        { opensAt: '09:00', closesAt: '12:00' },
        { opensAt: '12:00', closesAt: '14:00' },
      ],
    ],
  ])('accepts %s', (_description, intervals) => {
    expect(areIntervalsConsistent(intervals)).toBe(true);
  });

  it.each([
    ['closing before opening', [{ opensAt: '14:00', closesAt: '09:00' }]],
    ['zero-length interval', [{ opensAt: '09:00', closesAt: '09:00' }]],
    [
      'overlapping intervals',
      [
        { opensAt: '09:00', closesAt: '13:00' },
        { opensAt: '12:00', closesAt: '16:00' },
      ],
    ],
  ])('rejects %s', (_description, intervals) => {
    expect(areIntervalsConsistent(intervals)).toBe(false);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('Atlantic/Canary')).toBe(true);
  });

  it.each(['Mars/Olympus', '', 'GMT+99', '../etc'])('rejects %j', (timeZone) => {
    expect(isValidTimeZone(timeZone)).toBe(false);
  });
});
