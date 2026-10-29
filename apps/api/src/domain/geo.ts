const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance in metres between two WGS84 points (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0)
  );
}

export interface GeofenceResult {
  distance: number;
  radius: number;
  inside: boolean;
}

/** Inside when distance <= radius. GPS accuracy is checked separately (a weak fix is rejected, not stretched). */
export function checkGeofence(
  point: { latitude: number; longitude: number },
  branch: { latitude: number; longitude: number },
  radius: number,
): GeofenceResult {
  const distance = distanceMeters(point.latitude, point.longitude, branch.latitude, branch.longitude);
  return { distance: Math.round(distance * 10) / 10, radius, inside: distance <= radius };
}

/**
 * Speed (km/h) needed to get from the previous scan to this one. A very high value means the location is
 * probably spoofed; it is recorded in remarks for review rather than blocking the scan.
 */
export function travelSpeedKmh(
  prev: { latitude: number; longitude: number; time: Date },
  next: { latitude: number; longitude: number; time: Date },
): number {
  const hours = Math.max((next.time.getTime() - prev.time.getTime()) / 3600000, 1 / 3600);
  return distanceMeters(prev.latitude, prev.longitude, next.latitude, next.longitude) / 1000 / hours;
}
