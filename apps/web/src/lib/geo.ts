import { t } from './i18n';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function dms(deg: string, min: string | undefined, sec: string | undefined, hemi: string) {
  const v = Number(deg) + Number(min || 0) / 60 + Number(sec || 0) / 3600;
  return /[SW]/i.test(hemi) ? -v : v;
}

/**
 * Reads a position from what people copy out of map apps:
 * "11.5564, 104.9282", Google Maps links (…/@11.55,104.92,17z, ?q=11.55,104.92, !3d11.55!4d104.92)
 * and degrees-minutes-seconds like 11°33'23.0"N 104°55'41.5"E.
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const s = (text || '').trim();
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},\\s*${num}`),
    new RegExp(`[?&](?:q|query|ll|destination)=${num},\\s*${num}`),
    new RegExp(`^${num}\\s*[,;\\s]\\s*${num}$`),
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && valid(Number(m[1]), Number(m[2]))) return { latitude: Number(m[1]), longitude: Number(m[2]) };
  }
  const d = s.match(/(\d{1,3})°\s*(?:(\d{1,2})['′]\s*)?(?:([\d.]+)["″]\s*)?([NS])[\s,]+(\d{1,3})°\s*(?:(\d{1,2})['′]\s*)?(?:([\d.]+)["″]\s*)?([EW])/i);
  if (d) {
    const lat = dms(d[1], d[2], d[3], d[4]);
    const lng = dms(d[5], d[6], d[7], d[8]);
    if (valid(lat, lng)) return { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
  }
  return null;
}

export class GeoError extends Error {
  constructor(readonly code: 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'insecure', message: string) {
    super(message);
  }
}

export async function permissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return p?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Watches GPS for up to `maxWait` ms and returns the best fix, stopping early once accuracy is good enough.
 * Phones often report a coarse network fix first and a precise GPS fix a few seconds later.
 */
export function getBestPosition({ goodAccuracy = 25, maxWait = 9000, onProgress }: { goodAccuracy?: number; maxWait?: number; onProgress?: (f: Fix) => void } = {}): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new GeoError('insecure', t('Location only works over https. Open the secure link of the attendance app.')));
    if (!('geolocation' in navigator)) return reject(new GeoError('unsupported', t('This browser cannot read your location.')));
    let best: Fix | null = null;
    let done = false;
    const finish = (err?: GeoError) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(err ?? new GeoError('timeout', t('Could not get your location in time. Move near a window or outside and try again.')));
    };
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const f = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy * 10) / 10 };
        if (!best || f.accuracy < best.accuracy) best = f;
        onProgress?.(best);
        if (best.accuracy <= goodAccuracy) finish();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) finish(new GeoError('denied', t('Location access is blocked for this app.')));
        else if (!best && err.code === err.POSITION_UNAVAILABLE) finish(new GeoError('unavailable', t('Your location is not available. Turn on Location / GPS on your phone.')));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWait },
    );
    const timer = setTimeout(() => finish(), maxWait);
  });
}
