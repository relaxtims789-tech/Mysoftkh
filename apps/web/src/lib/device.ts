/**
 * Device binding. On first use the browser creates a P-256 key pair whose private half is NON-EXTRACTABLE and kept in
 * IndexedDB: JavaScript can sign with it but nobody can copy it to another phone. The device id is the RFC 7638
 * thumbprint of the public key; every scan is signed with the private key.
 */
import { api, ApiError } from './api';
import { t } from './i18n';
import { describeDevice } from './platform';
import { deviceStorageGet, deviceStorageSet, isMiniApp } from './telegram';

const TG_KEY = 'qra-device-key';

const DB = 'qra-device';
const STORE = 'keys';
const KEY_ID = 'primary';

interface StoredKey {
  privateKey: CryptoKey;
  publicJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  id: string;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function b64url(buf: ArrayBuffer): string {
  let s = '';
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function thumbprint(jwk: StoredKey['publicJwk']): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}

let cached: StoredKey | null = null;

export function deviceSupported(): boolean {
  return typeof indexedDB !== 'undefined' && !!globalThis.crypto?.subtle;
}

/** Fallback copy for browsers that cannot store a CryptoKey: the private key as JWK (plain data). */
const JWK_ID = 'primary-jwk';
const LS_KEY = 'qra.deviceKey';

interface StoredJwk {
  privateJwk: JsonWebKey;
  publicJwk: StoredKey['publicJwk'];
  id: string;
}

const publicOf = (jwk: JsonWebKey) => ({ kty: 'EC' as const, crv: 'P-256' as const, x: jwk.x!, y: jwk.y! });

async function fromJwk(rec: StoredJwk): Promise<StoredKey> {
  const privateKey = await crypto.subtle.importKey('jwk', rec.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { privateKey, publicJwk: rec.publicJwk, id: rec.id };
}

function lsGet(): StoredJwk | undefined {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v ? (JSON.parse(v) as StoredJwk) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How the key is kept: 'secure' = locked key the browser cannot export; 'saved' = kept as data (browsers that cannot
 * store locked keys); 'temporary' = nothing could be saved (private browsing), so it is lost when the tab closes.
 */
export type KeyMode = 'secure' | 'saved' | 'temporary';
let keyMode: KeyMode = 'temporary';
export const deviceKeyMode = () => keyMode;

/** Finds the key saved earlier, in either form. */
async function loadKey(): Promise<StoredKey | undefined> {
  const k = await idbGet<StoredKey>(KEY_ID).catch(() => undefined);
  if (k?.privateKey && k.id) {
    keyMode = 'secure';
    return k;
  }
  const rec = (await idbGet<StoredJwk>(JWK_ID).catch(() => undefined)) ?? lsGet();
  if (rec?.privateJwk && rec.id) {
    keyMode = 'saved';
    return fromJwk(rec).catch(() => undefined);
  }
  // Telegram may clear its in-app browser data; its device storage keeps the key for this bot on this phone.
  if (isMiniApp()) {
    const saved = await deviceStorageGet(TG_KEY).catch(() => null);
    if (saved) {
      try {
        const tg = JSON.parse(saved) as StoredJwk;
        if (tg.privateJwk && tg.id) {
          await idbPut(JWK_ID, tg).catch(() => undefined);
          keyMode = 'saved';
          return await fromJwk(tg);
        }
      } catch {
        /* unreadable copy: a new key is made */
      }
    }
  }
  return undefined;
}

/**
 * Creates and saves the phone's key. Preferred: a non-extractable CryptoKey in IndexedDB (it can never be copied).
 * iPhone browsers other than Safari (Chrome, Edge… run inside Apple's WKWebView) refuse to store CryptoKeys, and some
 * browsers fail silently, so the saved key is read back; if that fails, the key is kept as JWK data instead, in
 * IndexedDB and localStorage. Either way the same key is used on every visit, so the phone is registered once.
 */
async function createKey(): Promise<StoredKey> {
  // Inside Telegram the key is kept as data so a copy can live in Telegram's device storage.
  const telegram = isMiniApp();
  if (!telegram) try {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const publicJwk = publicOf((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey);
    const k: StoredKey = { privateKey: pair.privateKey, publicJwk, id: await thumbprint(publicJwk) };
    await idbPut(KEY_ID, k);
    const back = await idbGet<StoredKey>(KEY_ID);
    if (back?.privateKey && back.id === k.id) {
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, back.privateKey, new Uint8Array([1]));
      keyMode = 'secure';
      return back;
    }
  } catch {
    /* fall through to the JWK form */
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const publicJwk = publicOf((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey);
  const rec: StoredJwk = { privateJwk, publicJwk, id: await thumbprint(publicJwk) };
  let saved = await idbPut(JWK_ID, rec).then(() => true, () => false);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rec));
    saved = true;
  } catch {
    /* storage full or blocked (private browsing) */
  }
  if (telegram && (await deviceStorageSet(TG_KEY, JSON.stringify(rec)).catch(() => false))) saved = true;
  keyMode = saved ? 'saved' : 'temporary';
  return fromJwk(rec);
}

/** The phone's key, created the first time and reused on every later visit. */
export async function getDeviceKey(): Promise<StoredKey> {
  if (cached) return cached;
  if (!deviceSupported()) throw new ApiError(0, 'NO_CRYPTO', t('This browser cannot secure attendance. Open the app in Chrome or Safari over https.'));
  // Ask the browser not to clear this site's storage when space runs low.
  navigator.storage?.persist?.().catch(() => undefined);
  cached = (await loadKey()) ?? (await createKey());
  return cached;
}

export async function sign(message: string): Promise<string> {
  const k = await getDeviceKey();
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, new TextEncoder().encode(message));
  return b64url(sig);
}


export interface DeviceStatus {
  registered: boolean;
  device: { id: string; status: 'active' | 'pending' | 'rejected' | 'revoked'; deviceName: string | null } | null;
  message: string;
  bindingRequired: boolean;
}

export async function deviceStatus(): Promise<DeviceStatus> {
  const k = await getDeviceKey();
  return api<DeviceStatus>('/devices/me/status', { query: { identifier: k.id } });
}

/** Registers this phone (signing a fresh challenge to prove it holds the key). */
export async function registerDevice(): Promise<{ device: { status: string }; message: string }> {
  const k = await getDeviceKey();
  const { challenge } = await api<{ challenge: string }>('/attendance/challenge');
  const signature = await sign(`QRA-REGISTER|${challenge}`);
  const { name, platform } = await describeDevice();
  return api('/devices/register', { body: { publicKey: k.publicJwk, deviceName: name, platform, challenge, signature } });
}

/** Exactly what the server verifies: QRA-SCAN|challenge|qrToken|type|lat|lng|accuracy */
export function scanMessage(p: { challenge: string; qrToken: string; type?: string | null; latitude?: number | null; longitude?: number | null; accuracy?: number | null }) {
  const v = (x: unknown) => (x === undefined || x === null ? '' : String(x));
  return ['QRA-SCAN', p.challenge, p.qrToken, v(p.type), v(p.latitude), v(p.longitude), v(p.accuracy)].join('|');
}
