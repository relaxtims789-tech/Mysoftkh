import { useState } from 'react';
import { api } from '../lib/api';
import { shortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { Empty, ErrorText, Loading, useLoad } from '../components/ui';
import { PageHead, usePolling } from './shared';
import { roundTop } from './TrendChart';

interface Count { views: number; visitors: number }
interface Row { name: string; views: number; visitors: number }
interface Day { date: string; views: number; visitors: number; signups: number }
interface Stats {
  days: number; from: string; online: number;
  today: Count; yesterday: Count; week: Count; month: Count; allTime: Count & { since: string | null };
  signups: number; daily: Day[]; pages: Row[]; referrers: Row[]; devices: Row[]; languages: Row[];
}

const PAGE: Record<string, string> = { '/': t('Home page'), '/signup': t('Sign-up (free trial)'), '/terms': t('Terms & privacy'), '/refund-policy': t('Cancellation & refunds') };
const DEVICE: Record<string, string> = { mobile: t('Phone'), tablet: t('Tablet'), desktop: t('Computer') };
const LANG: Record<string, string> = { en: t('English'), km: t('Khmer'), '': t('Not set') };
const n = (v: number) => v.toLocaleString('en-US');

/** Super admin only: people visiting the public website (anonymous counts, no personal data). */
export function Visitors() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad(() => api<Stats>(`/platform/visitors?days=${days}`), [days]);
  usePolling(reload, 60_000);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorText error={error} />;
  const conv = data.month.visitors ? (data.signups / Math.max(1, data.daily.reduce((a, d) => a + d.visitors, 0))) * 100 : 0;

  return (
    <>
      <PageHead title={t('Website visitors')} sub={t('People who opened the public website (www.mysoftkh.com). Anonymous: no names or IP addresses are kept. Updates every minute.')}>
        <div className="tabs" style={{ border: 0 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} className={`tab${days === d ? ' active' : ''}`} onClick={() => setDays(d)}>{t('{n} days', { n: d })}</button>
          ))}
        </div>
      </PageHead>

      <div className="kpis">
        <Tile label={t('Online now')} value={data.online} sub={t('in the last 5 minutes')} live />
        <Tile label={t('Today')} value={data.today.visitors} sub={t('{n} page views', { n: n(data.today.views) })} />
        <Tile label={t('Yesterday')} value={data.yesterday.visitors} sub={t('{n} page views', { n: n(data.yesterday.views) })} />
        <Tile label={t('Last 7 days')} value={data.week.visitors} sub={t('{n} page views', { n: n(data.week.views) })} />
        <Tile label={t('Last 30 days')} value={data.month.visitors} sub={t('{n} page views', { n: n(data.month.views) })} />
        <Tile label={t('All time')} value={data.allTime.visitors} sub={data.allTime.since ? t('since {date}', { date: shortDate(data.allTime.since) }) : t('no visits yet')} />
        <Tile label={t('Sign-ups, {n} days', { n: data.days })} value={data.signups} sub={data.signups ? t('{pct}% of visitors', { pct: conv.toFixed(1) }) : t('free-trial companies')} />
      </div>

      <div className="card">
        <div className="card-head"><h2>{t('Visitors per day')}</h2><span className="faint small">{t('Last {n} days · hover a bar for details', { n: data.days })}</span></div>
        <div className="card-body">
          <DailyChart data={data.daily} />
          <details style={{ marginTop: 10 }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>{t('Show as a table')}</summary>
            <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto', marginTop: 8 }}>
              <table className="table">
                <thead><tr><th>{t('Day')}</th><th className="num">{t('Visitors')}</th><th className="num">{t('Page views')}</th><th className="num">{t('Sign-ups')}</th></tr></thead>
                <tbody>{[...data.daily].reverse().map((d) => <tr key={d.date}><td>{shortDate(d.date)}</td><td className="num">{n(d.visitors)}</td><td className="num">{n(d.views)}</td><td className="num">{d.signups}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>
      </div>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <Top title={t('Most visited pages')} rows={data.pages} label={(r) => PAGE[r.name] ?? r.name} />
        <Top title={t('Where visitors come from')} rows={data.referrers} label={(r) => r.name || t('Typed the address / bookmark')} />
        <Top title={t('Device')} rows={data.devices} label={(r) => DEVICE[r.name] ?? r.name} />
        <Top title={t('Website language')} rows={data.languages} label={(r) => LANG[r.name] ?? r.name} />
      </div>
      <p className="faint small">
        {t('A visitor is one browser: the same person on a phone and a computer counts twice. Search engines and link previews are not counted, nor is opening the same page again within 10 minutes. Signed-in users are not counted.')}
      </p>
    </>
  );
}

function Tile({ label, value, sub, live }: { label: string; value: number; sub: string; live?: boolean }) {
  return (
    <div className="card kpi">
      <span className="k-label">{live && <span className="k-mark" style={{ background: 'var(--chart-good)', borderRadius: '50%' }} />}{label}</span>
      <span className="k-value">{n(value)}</span>
      <span className="k-sub">{sub}</span>
    </div>
  );
}

/** Share of visitors per row, as a thin bar behind the numbers (one hue; the numbers carry the meaning). */
function Top({ title, rows, label }: { title: string; rows: Row[]; label: (r: Row) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <div className="card">
      <div className="card-head"><h2>{title}</h2></div>
      {rows.length === 0 ? <Empty icon="chart">{t('No visits in this period.')}</Empty> : (
        <table className="table">
          <thead><tr><th></th><th className="num">{t('Visitors')}</th><th className="num">{t('Views')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <div>{label(r)}</div>
                  <div style={{ height: 4, marginTop: 4, borderRadius: 2, background: 'var(--surface-3)' }}>
                    <div style={{ height: 4, width: `${(r.visitors / max) * 100}%`, borderRadius: 2, background: 'var(--primary)' }} />
                  </div>
                </td>
                <td className="num"><b>{n(r.visitors)}</b></td>
                <td className="num muted">{n(r.views)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Unique visitors per day: one series of thin bars with rounded tops; hover shows visitors, views and sign-ups. */
function DailyChart({ data }: { data: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, L = 36, R = 8, T = 10, B = 26;
  const max = Math.max(4, ...data.map((d) => d.visitors));
  const step = Math.pow(10, Math.floor(Math.log10(max / 4)));
  const nice = Math.ceil(max / 4 / step) * step * 4;
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const slot = (W - L - R) / Math.max(data.length, 1);
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  const ticks = [0, nice / 4, nice / 2, (nice * 3) / 4, nice];
  const every = data.length > 31 ? 14 : data.length > 7 ? 5 : 1;
  const h = hover !== null ? data[hover] : null;
  if (!data.some((d) => d.visitors)) return <Empty icon="chart">{t('No visitors yet in this period. Share www.mysoftkh.com!')}</Empty>;

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Website visitors per day, last {n} days', { n: data.length })}>
        <g className="grid">{ticks.map((t) => <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />)}</g>
        <g className="axis">
          {ticks.map((t) => <text key={t} x={L - 6} y={y(t) + 4} textAnchor="end">{n(Math.round(t))}</text>)}
          {data.map((d, i) => (i % every === 0 || i === data.length - 1) && (
            <text key={d.date} x={L + slot * i + slot / 2} y={H - 8} textAnchor="middle">
              {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
            </text>
          ))}
        </g>
        {data.map((d, i) => {
          const x = L + slot * i + (slot - bw) / 2;
          const hgt = y(0) - y(d.visitors);
          return (
            <g key={d.date} opacity={hover === null || hover === i ? 1 : 0.55}>
              {d.visitors > 0 && <path fill="var(--primary)" d={roundTop(x, y(d.visitors), bw, hgt, Math.min(4, hgt, bw / 2))} />}
              <rect className="hit" x={L + slot * i} y={T} width={slot} height={H - T - B} onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="tooltip" style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(h.visitors) / H) * 100}%`, transform: hover > data.length * 0.75 ? 'translate(calc(-100% - 8px), -40%)' : hover < data.length * 0.15 ? 'translate(8px, -40%)' : undefined }}>
          <div style={{ fontWeight: 650, marginBottom: 4 }}>{new Date(`${h.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
          <div className="t-row"><span>{t('Visitors')}</span><b>{n(h.visitors)}</b></div>
          <div className="t-row"><span>{t('Page views')}</span><b>{n(h.views)}</b></div>
          <div className="t-row"><span>{t('Sign-ups')}</span><b>{h.signups}</b></div>
        </div>
      )}
    </div>
  );
}
