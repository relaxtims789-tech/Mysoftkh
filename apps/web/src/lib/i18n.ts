/**
 * English / Khmer for the apps (admin dashboard, staff app, /manage). The English text itself is the key:
 *   t('Add employee')                     -> "បន្ថែមបុគ្គលិក" in Khmer
 *   t('{n} employees', { n: 12 })         -> placeholders in {braces}
 * Khmer texts live in ./i18n/km-*.ts (one file per area, merged here). A text without a Khmer entry stays English.
 * The choice is kept in localStorage "qra.lang" (shared with the public website) and switching reloads the page,
 * so texts computed when a module loads are always in the right language.
 */

export type Lang = 'en' | 'km';
const STORE = 'qra.lang';

function initial(): Lang {
  try {
    const asked = new URLSearchParams(location.search).get('lang');
    if (asked === 'en' || asked === 'km') {
      localStorage.setItem(STORE, asked);
      return asked;
    }
    const saved = localStorage.getItem(STORE);
    if (saved === 'en' || saved === 'km') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('km') ? 'km' : 'en';
}

export const lang: Lang = typeof window === 'undefined' ? 'en' : initial();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

const modules = import.meta.glob<{ default: Record<string, string> }>('./i18n/km-*.ts', { eager: true });
// Merged in file-name order, so km-zz-agreed.ts (one Khmer for words translated differently) wins.
const KM: Record<string, string> = Object.assign({}, ...Object.keys(modules).sort().map((k) => modules[k].default));

/** Texts asked for in Khmer that have no translation yet (development: window.__missingKm). */
const missing = new Set<string>();
if (typeof window !== 'undefined') (window as any).__missingKm = missing;

const fill = (s: string, vars?: Record<string, string | number | null | undefined>) =>
  vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]))) : s;

/** Translate an English UI text. */
export function t(text: string, vars?: Record<string, string | number | null | undefined>): string {
  if (lang === 'km') {
    const km = KM[text];
    if (km !== undefined) return fill(km, vars);
    if (text) missing.add(text);
  }
  return fill(text, vars);
}

/**
 * Translate a message that came from the server (errors, labels). Exact texts first; otherwise numbers are
 * swapped for "#" ("You have 6 active staff" -> "You have # active staff") and put back in order.
 */
export function tServer(message: string | null | undefined): string {
  if (!message) return '';
  if (lang !== 'km') return message;
  if (KM[message] !== undefined) return KM[message];
  const nums: string[] = [];
  const pattern = message.replace(/\d+(?:[.,]\d+)*/g, (n) => (nums.push(n), '#'));
  const km = KM[pattern];
  if (km === undefined) {
    missing.add(pattern);
    return message;
  }
  let i = 0;
  return km.replace(/#/g, () => nums[i++] ?? '#');
}

export function setLang(l: Lang) {
  try {
    localStorage.setItem(STORE, l);
  } catch {
    /* storage unavailable */
  }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url.toString());
}

/** Khmer month names for dates. */
export const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
export const KM_DAYS = ['អាទិត្យ', 'ច័ន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
