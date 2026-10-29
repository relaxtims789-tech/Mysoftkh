import { useState } from 'react';
import { dayLabel } from '../lib/format';
import { lang, t } from '../lib/i18n';

export interface TrendPoint { date: string; present: number; late: number; absent: number; leave: number; total: number }

/**
 * 14-day stacked bars: on time / late / absent / leave. Status colours always come with the legend and the
 * hover tooltip (never colour alone); 2px surface gaps between segments; thin bars with rounded tops.
 */
const SERIES = [
  { key: 'onTime', label: t('On time'), color: 'var(--chart-good)' },
  { key: 'late', label: t('Late'), color: 'var(--chart-warn)' },
  { key: 'leave', label: t('Leave'), color: 'var(--chart-info)' },
  { key: 'absent', label: t('Absent'), color: 'var(--chart-bad)' },
] as const;

/** One- or two-letter weekday under each bar (Sunday first). */
const KM_NARROW_DAYS = ['អា', 'ច', 'អ', 'ពុ', 'ព្រ', 'សុ', 'ស'];

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 230, L = 36, R = 8, T = 10, B = 34;
  const rows = data.map((d) => ({ ...d, onTime: d.present - d.late }));
  const max = Math.max(4, ...rows.map((r) => r.onTime + r.late + r.absent + r.leave));
  const nice = Math.ceil(max / 4) * 4 > max ? Math.ceil(max / 4) * 4 : max;
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const slot = (W - L - R) / Math.max(rows.length, 1);
  const bw = Math.min(28, slot * 0.6);
  const ticks = [0, nice / 4, nice / 2, (nice * 3) / 4, nice].map(Math.round);
  const h = hover !== null ? rows[hover] : null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="legend" aria-hidden="true">
        {SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="chart" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Attendance over the last 14 days')}>
          <g className="grid">
            {ticks.map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} />)}
          </g>
          <g className="axis">
            {ticks.map((v) => <text key={v} x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text>)}
            {rows.map((r, i) => {
              const d = new Date(`${r.date}T00:00:00Z`);
              return (
                <text key={r.date} x={L + slot * i + slot / 2} y={H - 14} textAnchor="middle">
                  {d.getUTCDate()}
                  <tspan x={L + slot * i + slot / 2} dy="12" style={{ fontSize: 9.5 }}>{lang === 'km' ? KM_NARROW_DAYS[d.getUTCDay()] : d.toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })}</tspan>
                </text>
              );
            })}
          </g>
          {rows.map((r, i) => {
            const x = L + slot * i + (slot - bw) / 2;
            let acc = 0;
            const segs = SERIES.map((s) => ({ s, v: (r as any)[s.key] as number })).filter((p) => p.v > 0);
            return (
              <g key={r.date} opacity={hover === null || hover === i ? 1 : 0.55}>
                {segs.map(({ s, v }, j) => {
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const top = j === segs.length - 1;
                  const hgt = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
                  return top ? (
                    <path key={s.key} fill={s.color} d={roundTop(x, y1, bw, hgt, Math.min(4, hgt))} />
                  ) : (
                    <rect key={s.key} fill={s.color} x={x} y={y1} width={bw} height={hgt} />
                  );
                })}
                <rect className="hit" x={L + slot * i} y={T} width={slot} height={H - T - B} onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div className="tooltip" style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(h.onTime + h.late + h.absent + h.leave) / H) * 100}%` }}>
            <div style={{ fontWeight: 650, marginBottom: 4 }}>{dayLabel(h.date)}</div>
            {SERIES.map((s) => (
              <div className="t-row" key={s.key}>
                <span className="row" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}</span>
                <b>{(h as any)[s.key]}</b>
              </div>
            ))}
            {h.total === 0 && <div className="faint small">{t('Day off / holiday')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
