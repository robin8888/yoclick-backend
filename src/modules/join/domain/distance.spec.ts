import { distanceInKilometers } from './distance';

const MADRID = { latitude: 40.4168, longitude: -3.7038 };
const BARCELONA = { latitude: 41.3874, longitude: 2.1686 };

describe('distanceInKilometers', () => {
  it('is zero between the same point', () => {
    expect(distanceInKilometers(MADRID, MADRID)).toBe(0);
  });

  it('measures Madrid to Barcelona at about 505 km', () => {
    expect(distanceInKilometers(MADRID, BARCELONA)).toBeCloseTo(505, -1);
  });

  it('is symmetric', () => {
    expect(distanceInKilometers(MADRID, BARCELONA)).toBeCloseTo(
      distanceInKilometers(BARCELONA, MADRID),
      6,
    );
  });
});
