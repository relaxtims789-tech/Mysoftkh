import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './auth';

/** Random id kept in this browser so a visitor is counted once per day; it identifies nobody. */
function visitorId(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    let id = localStorage.getItem('mysoft.vid');
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = make();
      localStorage.setItem('mysoft.vid', id);
    }
    return id;
  } catch {
    return make(); // storage blocked (private mode): counted, just not recognised next time
  }
}

let firstView = true;

/**
 * Counts page views on the public website for the super admin's "Website visitors" page. Signed-in users and
 * automated browsers are not counted; the referrer is sent once, with the first page of the visit.
 */
export function useVisitCounter(lang: string) {
  const { pathname } = useLocation();
  const { user, ready } = useAuth();
  useEffect(() => {
    if (!ready || user || navigator.webdriver) return;
    const body = { visitorId: visitorId(), path: pathname.replace(/\/+$/, '') || '/', lang, referrer: firstView && document.referrer ? document.referrer : undefined };
    firstView = false;
    fetch('/api/public/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
    // lang is left out on purpose: switching language is not a new page view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, ready, !!user]);
}
