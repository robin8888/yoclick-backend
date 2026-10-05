import { SECTOR_IDS } from '../http/create-center.dto';
import { areIntervalsConsistent } from '../../centers/domain/opening-hours';
import { DEFAULT_OPENING_HOURS } from './default-opening-hours';
import { SECTOR_SERVICE_SUGGESTIONS, suggestServicesForSector } from './sector-service-suggestions';

const MIN_SERVICE_DURATION_MINUTES = 15;
const MAX_SERVICE_DURATION_MINUTES = 480;
const DURATION_STEP_MINUTES = 5;

describe('sector service suggestions', () => {
  it('has suggestions for every sector a center can pick, and no others', () => {
    const byName = (first: string, second: string): number => first.localeCompare(second);

    expect(Object.keys(SECTOR_SERVICE_SUGGESTIONS).sort(byName)).toEqual(
      [...SECTOR_IDS].sort(byName),
    );
  });

  it.each(SECTOR_IDS)('suggests four distinct, valid services for "%s"', (sectorId) => {
    const suggestions = suggestServicesForSector(sectorId);

    expect(suggestions).toHaveLength(4);
    expect(new Set(suggestions.map(({ name }) => name)).size).toBe(suggestions.length);
    for (const { name, durationMinutes } of suggestions) {
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(80);
      expect(durationMinutes).toBeGreaterThanOrEqual(MIN_SERVICE_DURATION_MINUTES);
      expect(durationMinutes).toBeLessThanOrEqual(MAX_SERVICE_DURATION_MINUTES);
      expect(durationMinutes % DURATION_STEP_MINUTES).toBe(0);
    }
  });

  it.each([
    { sectorId: 'marciales', first: { name: 'Karate infantil', durationMinutes: 60 } },
    { sectorId: 'readap', first: { name: 'Sesión de readaptación', durationMinutes: 50 } },
    { sectorId: 'cocina', first: { name: 'Cocina básica', durationMinutes: 120 } },
    { sectorId: 'box', first: { name: 'WOD en grupo', durationMinutes: 60 } },
  ])('starts "$sectorId" with the service from the prototype', ({ sectorId, first }) => {
    expect(suggestServicesForSector(sectorId)[0]).toEqual(first);
  });

  it('falls back to the generic sector for an unknown one', () => {
    expect(suggestServicesForSector('astronomy')).toBe(SECTOR_SERVICE_SUGGESTIONS.otro);
    expect(suggestServicesForSector('__proto__')).toBe(SECTOR_SERVICE_SUGGESTIONS.otro);
  });
});

describe('default opening hours', () => {
  it('opens Monday to Friday 09:00-14:00 and 16:00-20:00 and closes the weekend', () => {
    for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
      expect(DEFAULT_OPENING_HOURS[weekday]).toEqual([
        { opensAt: '09:00', closesAt: '14:00' },
        { opensAt: '16:00', closesAt: '20:00' },
      ]);
    }
    expect(DEFAULT_OPENING_HOURS.sat).toEqual([]);
    expect(DEFAULT_OPENING_HOURS.sun).toEqual([]);
  });

  it('is consistent: shifts open before they close and do not overlap', () => {
    expect(areIntervalsConsistent(DEFAULT_OPENING_HOURS.mon ?? [])).toBe(true);
  });
});
