/** Display helpers. Times from the API are already in the company's local time ("HH:MM"). Dates follow the chosen language. */
import { KM_DAYS, KM_MONTHS, lang, t } from './i18n';

const km = lang === 'km';
const utc = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`);

export function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return '--:--';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "Tuesday, 6 October 2026" for a YYYY-MM-DD date. */
export function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (km) return `ថ្ងៃ${KM_DAYS[d.getUTCDay()]} ទី${d.getUTCDate()} ${KM_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "06-Oct-2026" */
export function shortDate(date: string | null | undefined): string {
  if (!date) return '';
  const d = utc(date);
  if (km) return `${String(d.getUTCDate()).padStart(2, '0')}-${KM_MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
  return `${String(d.getUTCDate()).padStart(2, '0')}-${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}-${d.getUTCFullYear()}`;
}

/** "Tue 6 Oct" */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (km) return `${KM_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${KM_MONTHS[d.getUTCMonth()]}`;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function dateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  if (km) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.day} ${KM_MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
  }
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
}

export function hm(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '';
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
}

export function greeting(hour = new Date().getHours()): string {
  return t(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}

export function monthLabel(month: string): string {
  if (km) return `${KM_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export const DAY_STATUS: Record<string, { label: string; tone: string }> = {
  present: { label: t('On time'), tone: 'good' },
  late: { label: t('Late'), tone: 'warn' },
  absent: { label: t('Absent'), tone: 'bad' },
  leave: { label: t('Leave'), tone: 'info' },
  holiday: { label: t('Holiday'), tone: 'muted' },
  day_off: { label: t('Day off'), tone: 'muted' },
  not_yet: { label: t('Not yet in'), tone: 'muted' },
  upcoming: { label: '', tone: 'muted' },
};

export const PUNCH_STATUS: Record<string, { label: string; tone: string }> = {
  on_time: { label: t('On time'), tone: 'good' },
  late: { label: t('Late'), tone: 'warn' },
  early_leave: { label: t('Early leave'), tone: 'warn' },
  overtime: { label: t('Overtime'), tone: 'info' },
  off_day: { label: t('Day off'), tone: 'muted' },
};

export const FLAG_LABEL: Record<string, string> = {
  early_leave: t('Early leave'), overtime: t('Overtime'), missing_check_in: t('No check-in'), missing_check_out: t('No check-out'),
  late_from_lunch: t('Late from lunch'), worked_on_leave: t('Worked on leave'),
};

export const LEAVE_TYPES: Record<string, string> = {
  annual: t('Annual leave'), sick: t('Sick leave'), personal: t('Personal leave'), maternity: t('Maternity leave'), unpaid: t('Unpaid leave'), other: t('Other'),
};

export const TYPE_LABEL: Record<string, string> = { check_in: t('Check-in'), lunch_out: t('Lunch-out'), lunch_in: t('Lunch-in'), check_out: t('Check-out') };

export const SOURCE_LABEL: Record<string, string> = { qr: t('QR'), button: t('Phone button'), manual: t('Manual'), correction: t('Correction'), zkteco: t('ZKTeco'), face: t('Face'), import: t('Import') };
