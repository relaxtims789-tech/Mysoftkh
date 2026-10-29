import { checkGeofence, distanceMeters, isValidCoordinate, travelSpeedKmh } from './geo';
import { localParts, zonedToUtc } from './time';

const branch = { latitude: 11.5564, longitude: 104.9282 }; // CAM Phnom Penh (spec example)

describe('geofence', () => {
  it('distance to itself is 0', () => {
    expect(distanceMeters(11.5564, 104.9282, 11.5564, 104.9282)).toBe(0);
  });

  it('~111 m per 0.001 deg latitude', () => {
    expect(distanceMeters(11.5564, 104.9282, 11.5574, 104.9282)).toBeCloseTo(111.2, 0);
  });

  it('inside a 100 m radius', () => {
    const r = checkGeofence({ latitude: 11.5568, longitude: 104.9285 }, branch, 100);
    expect(r.inside).toBe(true);
    expect(r.distance).toBeLessThan(100);
  });

  it('outside a 100 m radius', () => {
    const r = checkGeofence({ latitude: 11.5580, longitude: 104.9282 }, branch, 100);
    expect(r.inside).toBe(false);
    expect(r.distance).toBeGreaterThan(170);
  });

  it('rejects junk coordinates', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(NaN, 1)).toBe(false);
    expect(isValidCoordinate('11' as any, 104)).toBe(false);
    expect(isValidCoordinate(11.55, 104.92)).toBe(true);
  });

  it('travel speed flags impossible jumps', () => {
    const t = new Date('2026-10-06T01:00:00Z');
    const speed = travelSpeedKmh({ ...branch, time: t }, { latitude: 13.3671, longitude: 103.8448, time: new Date(t.getTime() + 10 * 60000) });
    expect(speed).toBeGreaterThan(1000);
  });
});

describe('time zones', () => {
  it('Phnom Penh is UTC+7', () => {
    const p = localParts(new Date('2026-10-06T00:55:00Z'), 'Asia/Phnom_Penh');
    expect(p).toMatchObject({ date: '2026-10-06', time: '07:55', weekday: 2 }); // a Tuesday
  });
  it('zonedToUtc round-trips', () => {
    expect(zonedToUtc('2026-10-06', '08:03', 'Asia/Phnom_Penh').toISOString()).toBe('2026-10-06T01:03:00.000Z');
    expect(zonedToUtc('2026-03-08', '09:00', 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });
});
