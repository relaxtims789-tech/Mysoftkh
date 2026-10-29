/**
 * API client. The access token lives in memory only; the refresh token is an httpOnly cookie the browser sends to
 * /api/auth/refresh. A 401 triggers one shared refresh, then the request is retried once.
 */
import { isMiniApp, telegramBot, telegramInitData } from './telegram';
import { t } from './i18n';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: any) {
    super(message);
  }
}

/** Shown when the request never reached the server (offline, or the server is not running). */
const NETWORK_MESSAGE = t('Cannot reach the attendance server. Check your internet connection; if it is working, the server may be stopped (on the server PC, run start.bat).');

let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;
const listeners = new Set<(s: SessionResponse | null) => void>();

export interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: Me;
}

export type Role = 'super_admin' | 'company_admin' | 'hr' | 'manager' | 'employee';

/** Subscription state of the company (see the API domain/billing.ts). */
export interface Billing {
  state: 'exempt' | 'trial' | 'active' | 'grace' | 'expired';
  coveredUntil: string | null;
  graceUntil: string | null;
  daysLeft: number | null;
  readOnly: boolean;
}

export interface Me {
  id: string;
  name: string;
  role: Role;
  email: string | null;
  username: string;
  mustChangePassword: boolean;
  departmentIds: string[] | null;
  company: { id: string; name: string; code: string; logo: string | null; timezone: string; billing?: Billing } | null;
  employee: {
    id: string; code: string; name: string; phone: string | null; email: string | null; photo: string | null;
    department: string | null; position: string | null; branch: string | null; branchId: string | null;
  } | null;
}

/** Super admins pick the company they work on; it is sent as X-Company-Id. */
export function getCompanyOverride(): string | null {
  try {
    return localStorage.getItem('qra.company');
  } catch {
    return null;
  }
}
export function setCompanyOverride(id: string | null) {
  try {
    if (id) localStorage.setItem('qra.company', id);
    else localStorage.removeItem('qra.company');
  } catch {
    /* storage unavailable */
  }
}

export function onSession(fn: (s: SessionResponse | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Starts a session from a response that already signed the user in (sign-up). */
export function startSession(s: SessionResponse) {
  setSession(s);
}

function setSession(s: SessionResponse | null) {
  accessToken = s?.accessToken ?? null;
  listeners.forEach((l) => l(s));
}

async function parseError(res: Response): Promise<ApiError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (res.status === 0 || !body) return new ApiError(res.status, 'NETWORK', res.status >= 500 ? t('The server is not responding. Please try again.') : t('Request failed ({status}).', { status: res.status }));
  return new ApiError(res.status, body.code || 'ERROR', body.message || t('Something went wrong.'), body.details);
}

export async function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        let res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: companyHeaders() });
        if (!res.ok && isMiniApp() && telegramInitData()) {
          res = await fetch('/api/auth/telegram', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...companyHeaders() }, body: JSON.stringify({ initData: telegramInitData(), bot: telegramBot() }) });
        }
        if (!res.ok) {
          setSession(null);
          return null;
        }
        const s = (await res.json()) as SessionResponse;
        setSession(s);
        return s;
      } catch {
        return null;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

function companyHeaders(): Record<string, string> {
  const c = getCompanyOverride();
  return c ? { 'X-Company-Id': c } : {};
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  form?: FormData;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL(path.startsWith('/api') ? path : `/api${path}`, location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.pathname + url.search;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...companyHeaders() };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  return fetch(buildUrl(path, opts.query), { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', signal: opts.signal });
}

async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
  let res: Response;
  try {
    res = await send(path, opts);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }
  if (res.status === 401 && !path.includes('/auth/')) {
    const s = await refreshSession();
    if (s) res = await send(path, opts);
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(path, opts);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** A file from an authenticated endpoint as a Blob (e.g. to show a receipt). */
export async function apiBlob(path: string): Promise<Blob> {
  return (await request(path)).blob();
}

/** Downloads a file from an authenticated endpoint (reports, QR PNG). */
export async function download(path: string, query?: RequestOptions['query'], fallbackName = 'download') {
  const res = await request(path, { query });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function login(body: { companyCode?: string; login: string; password: string }): Promise<SessionResponse> {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }).catch(() => null);
  if (!res) throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  if (!res.ok) throw await parseError(res);
  const s = (await res.json()) as SessionResponse;
  setSession(s);
  return s;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  setSession(null);
}

export async function reloadMe(): Promise<Me> {
  const me = await api<Me>('/auth/me');
  listeners.forEach((l) => l(accessToken ? { accessToken, expiresIn: 0, user: me } : null));
  return me;
}
