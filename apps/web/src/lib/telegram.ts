/**
 * Telegram Mini App support. When the app is opened from the bot's "Attendance" button, Telegram adds its launch data
 * to the address (#tgWebAppData=...). We keep it for the session, sign in with it, and use Telegram's own QR scanner,
 * location, storage and back button, which work better inside Telegram than the browser ones.
 * https://core.telegram.org/bots/webapps
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Telegram?: { WebApp: any };
  }
}

interface Launch {
  initData: string;
  version: string;
  platform: string;
  /** Which bot opened the app: the staff bot opens /app, the admin bot opens /manage. */
  bot: 'staff' | 'admin';
}

import { t } from './i18n';

const KEY = 'qra.tgLaunch';
let launch: Launch | null = null;
let sdk: Promise<any | null> | null = null;

function readLaunch(): Launch | null {
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    const initData = hash.get('tgWebAppData');
    if (initData) {
      const l: Launch = {
        initData, version: hash.get('tgWebAppVersion') ?? '6.0', platform: hash.get('tgWebAppPlatform') ?? 'unknown',
        bot: location.pathname.startsWith('/manage') ? 'admin' : 'staff',
      };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(l));
      } catch {
        /* storage blocked */
      }
      return l;
    }
    const saved = sessionStorage.getItem(KEY);
    return saved ? (JSON.parse(saved) as Launch) : null;
  } catch {
    return null;
  }
}

/** Call once at start-up, before the router changes the address. */
export function detectMiniApp(): boolean {
  launch = readLaunch();
  if (launch) loadTelegram();
  return !!launch;
}

export const isMiniApp = () => !!launch;
export const telegramBot = () => launch?.bot ?? 'staff';
export const telegramInitData = () => window.Telegram?.WebApp?.initData || launch?.initData || '';

/** Loads telegram-web-app.js (only inside Telegram) and tells Telegram the app is ready. */
export function loadTelegram(): Promise<any | null> {
  if (!launch) return Promise.resolve(null);
  if (!sdk) {
    sdk = new Promise((resolve) => {
      if (window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      s.async = true;
      s.onload = () => {
        const w = window.Telegram?.WebApp ?? null;
        try {
          w?.ready();
          w?.expand();
          if (w?.isVersionAtLeast?.('7.7')) w.disableVerticalSwipes();
        } catch {
          /* older Telegram */
        }
        resolve(w);
      };
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return sdk;
}

async function webApp(minVersion?: string): Promise<any | null> {
  const w = await loadTelegram();
  if (!w) return null;
  if (minVersion && !w.isVersionAtLeast?.(minVersion)) return null;
  return w;
}

/** Telegram's built-in QR scanner. Resolves the scanned text, or null when closed. Null result when not available. */
export async function telegramScanQr(text: string, accept: (data: string) => boolean): Promise<string | null | undefined> {
  const w = await webApp('6.4');
  if (!w) return undefined;
  return new Promise((resolve) => {
    let done = false;
    const closed = () => {
      w.offEvent('scanQrPopupClosed', closed);
      if (!done) resolve(null);
    };
    w.onEvent('scanQrPopupClosed', closed);
    w.showScanQrPopup({ text }, (data: string) => {
      if (!accept(data)) {
        haptic('error');
        return false; // keep scanning
      }
      done = true;
      w.offEvent('scanQrPopupClosed', closed);
      resolve(data);
      return true;
    });
  });
}

export class TelegramLocationError extends Error {
  constructor(readonly code: 'denied' | 'unavailable', message: string) {
    super(message);
  }
}

/** Location through Telegram (Bot API 8.0+). Undefined when this Telegram version cannot do it (use the browser's). */
export async function telegramLocation(): Promise<{ latitude: number; longitude: number; accuracy: number } | undefined> {
  const w = await webApp('8.0');
  const lm = w?.LocationManager;
  if (!lm) return undefined;
  await new Promise<void>((resolve) => (lm.isInited ? resolve() : lm.init(() => resolve())));
  if (!lm.isLocationAvailable) throw new TelegramLocationError('unavailable', t('Location is not available on this device. Turn on Location / GPS.'));
  if (lm.isAccessRequested && !lm.isAccessGranted) {
    throw new TelegramLocationError('denied', t('Telegram is not allowed to use your location for this app.'));
  }
  const data = await new Promise<any>((resolve) => lm.getLocation((d: any) => resolve(d)));
  if (!data) throw new TelegramLocationError(lm.isAccessGranted ? 'unavailable' : 'denied', lm.isAccessGranted ? t('Could not get your location. Move near a window or outside and try again.') : t('Telegram is not allowed to use your location for this app.'));
  return { latitude: data.latitude, longitude: data.longitude, accuracy: Math.round((data.horizontal_accuracy ?? 50) * 10) / 10 };
}

export async function openTelegramLocationSettings() {
  const w = await webApp('8.0');
  w?.LocationManager?.openSettings?.();
}

export function haptic(type: 'success' | 'error' | 'warning') {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* not in Telegram */
  }
}

/** Telegram's storage on this device for this bot (Bot API 9.0+): survives the in-app browser clearing its data. */
export async function deviceStorageGet(key: string): Promise<string | null> {
  const w = await webApp('9.0');
  if (!w?.DeviceStorage) return null;
  return new Promise((resolve) => w.DeviceStorage.getItem(key, (err: unknown, value: string | null) => resolve(err ? null : value || null)));
}

export async function deviceStorageSet(key: string, value: string): Promise<boolean> {
  const w = await webApp('9.0');
  if (!w?.DeviceStorage) return false;
  return new Promise((resolve) => w.DeviceStorage.setItem(key, value, (err: unknown, ok: boolean) => resolve(!err && ok !== false)));
}

/** Lets the bot send messages (asked once when Telegram is connected). */
export async function requestWriteAccess(): Promise<boolean> {
  const w = await webApp('6.9');
  if (!w?.requestWriteAccess) return false;
  return new Promise((resolve) => w.requestWriteAccess((ok: boolean) => resolve(!!ok)));
}

/** Telegram's own back button (top left), shown on inner pages. */
export async function setBackButton(onClick: (() => void) | null) {
  const w = await webApp('6.1');
  const b = w?.BackButton;
  if (!b) return;
  b.offClick((b as any).__qraHandler ?? (() => undefined));
  if (onClick) {
    (b as any).__qraHandler = onClick;
    b.onClick(onClick);
    b.show();
  } else {
    b.hide();
  }
}

/** Opens a t.me link inside Telegram, or a normal link in the browser. */
export async function openTelegramLink(url: string) {
  const w = await webApp();
  if (w && url.startsWith('https://t.me/')) w.openTelegramLink(url);
  else location.href = url;
}
