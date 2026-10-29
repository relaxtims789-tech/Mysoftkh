import { useEffect, useState } from 'react';
import { api } from './api';

/** The public demo's shared sign-ins (GET /api/public/demo); `enabled` is false on every real server. */
export interface DemoInfo {
  enabled: boolean;
  companyCode?: string;
  adminLogin?: string;
  hrLogin?: string;
  managerLogin?: string;
  employeeId?: string;
  password?: string;
  resetHour?: number;
  mainSiteUrl?: string;
}

let cached: Promise<DemoInfo> | null = null;
export function loadDemo(): Promise<DemoInfo> {
  cached ??= api<DemoInfo>('/public/demo').catch(() => ({ enabled: false }));
  return cached;
}

/** Demo info once loaded; null while loading or when this is not the demo. */
export function useDemo(): DemoInfo | null {
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  useEffect(() => {
    let live = true;
    loadDemo().then((d) => live && setDemo(d.enabled ? d : null));
    return () => {
      live = false;
    };
  }, []);
  return demo;
}

/** "3:00 AM" */
export const resetTime = (h = 3) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
