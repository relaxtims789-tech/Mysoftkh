import { ReactNode, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}

export interface Named { id: string; name: string; status: string; employeeCount?: number }
export interface Branch { id: string; name: string; code: string; address: string | null; latitude: number; longitude: number; radius: number | null; status: string; employeeCount?: number; activeQrCount?: number }
export interface Schedule { id: string; name: string; startTime: string; endTime: string; lunchStart: string | null; lunchEnd: string | null; lateAfterMinutes: number; graceMinutes: number; workDays: number[]; isDefault: boolean; status: string; employeeCount?: number }

/** Reference lists used by filters and forms, loaded once per page. */
const cache = new Map<string, Promise<any>>();
export function invalidateRefs(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
function useRef<T>(key: string, path: string): T[] {
  const [data, setData] = useState<T[]>([]);
  useEffect(() => {
    if (!cache.has(key)) cache.set(key, api<T[]>(path).catch((e) => { cache.delete(key); throw e; }));
    let alive = true;
    cache.get(key)!.then((d) => alive && setData(d)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, path]);
  return data;
}
export const useBranches = () => useRef<Branch>('branches', '/branches');
export const useDepartments = () => useRef<Named>('departments', '/departments');
export const usePositions = () => useRef<Named>('positions', '/positions');
export const useSchedules = () => useRef<Schedule>('schedules', '/schedules');

export function Select({ value, onChange, options, placeholder, className = 'select', id }: { value: string; onChange: (v: string) => void; options: { id: string; name: string }[]; placeholder?: string; className?: string; id?: string }) {
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

export const WEEKDAYS = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];

export function mapLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

/** Polls a loader while the page is visible. */
export function usePolling(fn: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => document.visibilityState === 'visible' && fn(), ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled]);
}
