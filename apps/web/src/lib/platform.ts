/**
 * What phone and browser the employee is using: iPhone, Android (Samsung, Xiaomi, OPPO, vivo...) or Huawei HarmonyOS,
 * plus the browser. Used for device names, for help texts that match the phone, and to warn about in-app browsers
 * (Telegram, Facebook, LINE...) where the camera, location and storage do not work reliably.
 */
import { isMiniApp } from './telegram';

export type OsName = 'iOS' | 'Android' | 'HarmonyOS' | 'Windows' | 'macOS' | 'Linux' | 'Other';

export interface PhoneEnv {
  os: OsName;
  osVersion: string;
  browser: string;
  /** Name of the app whose built-in browser this is (Facebook, Telegram...), or null. */
  inApp: string | null;
  /** Opened from the home-screen icon (installed web app). */
  standalone: boolean;
  /** Browsers we test against and recommend for this OS. */
  supported: boolean;
  /** Browser to recommend on this OS. */
  recommended: string;
  mobile: boolean;
}

const IN_APP: [RegExp, string][] = [
  [/FBAN\/Messenger|FB_IAB\/MESSENGER|Orca-Android/i, 'Messenger'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/Instagram/i, 'Instagram'],
  [/\bLine\//i, 'LINE'],
  [/MicroMessenger/i, 'WeChat'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/Telegram/i, 'Telegram'],
  [/Zalo/i, 'Zalo'],
  [/Snapchat/i, 'Snapchat'],
];

export function detectEnv(ua = navigator.userAgent): PhoneEnv {
  const standalone = (navigator as any).standalone === true || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches);
  const iPadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;

  let os: OsName = 'Other';
  let osVersion = '';
  let m: RegExpMatchArray | null;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) {
    os = 'iOS';
    osVersion = (m = ua.match(/OS (\d+)[_.](\d+)/)) ? `${m[1]}.${m[2]}` : '';
  } else if ((m = ua.match(/OpenHarmony\s?([\d.]+)?/))) {
    os = 'HarmonyOS';
    osVersion = m[1] ? `NEXT (OpenHarmony ${m[1]})` : 'NEXT';
  } else if (/HarmonyOS/i.test(ua)) {
    os = 'HarmonyOS';
    osVersion = (m = ua.match(/HarmonyOS[ /]?([\d.]+)/i)) ? m[1] : '';
  } else if ((m = ua.match(/Android\s?([\d.]+)?/))) {
    os = 'Android';
    osVersion = m[1] ?? '';
  } else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let inApp: string | null = null;
  for (const [re, name] of IN_APP) if (re.test(ua)) { inApp = name; break; }
  // Opened as a Telegram Mini App: Telegram provides the QR scanner, location and storage, so it is supported.
  const miniApp = isMiniApp();
  if (miniApp) inApp = null;
  // Android apps showing pages in a plain WebView add "; wv)"; on iPhone such views lack the "Safari/" token.
  if (!inApp && !standalone && os === 'Android' && /; wv\)/.test(ua)) inApp = 'another app';
  if (!inApp && !standalone && os === 'iOS' && !/Safari\//.test(ua) && !/CriOS|EdgiOS|FxiOS|OPiOS/.test(ua)) inApp = 'another app';

  let browser = 'Browser';
  if (os === 'iOS') {
    browser = /CriOS/.test(ua) ? 'Chrome' : /EdgiOS/.test(ua) ? 'Edge' : /FxiOS/.test(ua) ? 'Firefox' : /OPiOS|OPT\//.test(ua) ? 'Opera' : 'Safari';
  } else {
    browser =
      /HuaweiBrowser|HONORBrowser/i.test(ua) ? (/HONOR/i.test(ua) ? 'Honor Browser' : 'Huawei Browser')
      : /ArkWeb/.test(ua) ? 'Huawei Browser'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
      : /MiuiBrowser|XiaoMi\//.test(ua) ? 'Mi Browser'
      : /HeyTapBrowser|OppoBrowser/i.test(ua) ? 'OPPO Browser'
      : /VivoBrowser/i.test(ua) ? 'vivo Browser'
      : /UCBrowser/.test(ua) ? 'UC Browser'
      : /EdgA?\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
      : /YaBrowser/.test(ua) ? 'Yandex'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari'
      : 'Browser';
  }
  if (inApp) browser = `${inApp} in-app browser`;
  if (miniApp) browser = 'Telegram';

  const recommended = os === 'iOS' ? 'Safari' : os === 'HarmonyOS' ? 'Huawei Browser' : 'Chrome';
  const supportedBrowsers: Record<OsName, string[]> = {
    iOS: ['Safari', 'Chrome', 'Edge'],
    Android: ['Chrome', 'Samsung Internet', 'Edge', 'Huawei Browser', 'Honor Browser', 'Firefox', 'Opera'],
    HarmonyOS: ['Huawei Browser', 'Honor Browser', 'Chrome', 'Edge'],
    Windows: ['Chrome', 'Edge', 'Firefox'],
    macOS: ['Safari', 'Chrome', 'Edge', 'Firefox'],
    Linux: ['Chrome', 'Firefox'],
    Other: [],
  };
  const supported = miniApp || (!inApp && supportedBrowsers[os].includes(browser));
  const mobile = os === 'iOS' || os === 'Android' || os === 'HarmonyOS';
  return { os, osVersion, browser, inApp, standalone, supported, recommended, mobile };
}

/** Real phone model when the browser tells it (Chromium on Android/HarmonyOS hides it from the user agent). */
export async function phoneModel(): Promise<string | null> {
  try {
    const uaData = (navigator as any).userAgentData;
    if (uaData?.getHighEntropyValues) {
      const v = await uaData.getHighEntropyValues(['model']);
      if (v.model) return String(v.model).trim();
    }
  } catch {
    /* not available */
  }
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; (?:HarmonyOS; )?([^;)]+?)(?: Build\/[^;)]*)?[;)]/);
  if (m && !/^(K|wv|Mobile)$/i.test(m[1].trim())) return m[1].trim();
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return null;
}

/** e.g. "SM-A546E · Samsung Internet" or "iPhone · Safari": what the admin sees in Phones. */
export async function describeDevice(): Promise<{ name: string; platform: string }> {
  const env = detectEnv();
  const model = (await phoneModel()) ?? (env.os === 'Other' ? 'Device' : env.os === 'HarmonyOS' ? 'Huawei phone' : `${env.os} device`);
  const browser = env.standalone ? `${env.browser === 'Safari' ? 'Home-screen app' : `${env.browser} app`}` : env.browser;
  return {
    name: `${model} · ${browser}`.slice(0, 80),
    platform: `${env.os}${env.osVersion ? ` ${env.osVersion}` : ''}`.slice(0, 40),
  };
}
