import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { FLAG_LABEL, hm, longDate, monthLabel, monthRange, SOURCE_LABEL, time12, LEAVE_TYPES } from '../lib/format';
import { KM_DAYS, lang, t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Badge, DayBadge, Empty, ErrorText, Loading, PunchBadge, useConfirm, useLoad, useToast } from '../components/ui';

interface OtMine { requiresApproval: boolean; days: { workDate: string; overtimeMinutes: number; countedMinutes: number; status: string; reason: string | null; reviewNote: string | null }[] }
import { MobileTop } from './EmployeeApp';
import type { TodayData } from './Home';

const TYPE_ICON = { check_in: 'logout', lunch_out: 'clock', lunch_in: 'clock', check_out: 'logout' } as const;

export function TodayScreen() {
  const { data, error, loading, reload } = useLoad(() => api<TodayData>('/attendance/today'), []);
  return (
    <>
      <MobileTop title={t("Today's attendance")} right={<button className="btn ghost icon" onClick={reload} aria-label={t('Refresh')}><Icon name="refresh" /></button>} />
      <div className="m-page">
        {loading && !data && <Loading />}
        <ErrorText error={error} />
        {data && (
          <>
            <div className="card card-pad stack tight">
              <div className="row between">
                <strong>{longDate(data.date)}</strong>
                {data.summary && <DayBadge status={data.summary.status} />}
              </div>
              {data.schedule && <div className="muted small">{t('Schedule {start} – {end}', { start: time12(data.schedule.startTime), end: time12(data.schedule.endTime) })}{data.schedule.lunchStart ? ` · ${t('lunch {start}–{end}', { start: time12(data.schedule.lunchStart), end: time12(data.schedule.lunchEnd) })}` : ''}</div>}
              {data.summary && data.summary.workedMinutes > 0 && <div className="small">{t('Worked')} <b>{hm(data.summary.workedMinutes)}</b></div>}
            </div>
            <div className="card card-pad">
              {data.records.length === 0 ? (
                <Empty icon="clock">{t('No scans yet today.')}</Empty>
              ) : (
                <div className="timeline">
                  {data.records.map((r) => (
                    <div className="tl-item" key={r.id}>
                      <span className="tl-dot" style={r.type === 'check_out' ? { transform: 'scaleX(-1)' } : undefined}><Icon name={TYPE_ICON[r.type as keyof typeof TYPE_ICON] ?? 'clock'} size={17} /></span>
                      <div className="grow">
                        <div style={{ fontWeight: 650 }}>{tServer(r.typeLabel)}</div>
                        <div className="faint small">
                          {r.branchName ?? SOURCE_LABEL[r.source]}{r.distance != null ? ` · ${Math.round(r.distance)} m` : ''}{r.source !== 'qr' ? ` · ${SOURCE_LABEL[r.source]}` : ''}
                        </div>
                      </div>
                      <div className="right">
                        <div className="tl-time">{time12(r.time)}</div>
                        <PunchBadge status={r.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {data.rules.allowEmployeeCorrections && (
              <Link className="btn block" to="/app/corrections"><Icon name="wrench" size={16} /> {t('Missed a scan? Request a correction')}</Link>
            )}
          </>
        )}
      </div>
    </>
  );
}

interface HistoryData {
  from: string;
  to: string;
  totals: { present: number; late: number; absent: number; leave: number; lateMinutes: number; overtimeMinutes: number; workedMinutes: number };
  days: {
    date: string; status: string; flags: string[]; lateMinutes: number; overtimeMinutes: number; workedMinutes: number; holiday: string | null; leaveType: string | null;
    records: { id: string; type: string; time: string; status: string }[];
  }[];
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(m: string, n: number) {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

export function HistoryScreen() {
  const [month, setMonth] = useState(currentMonth);
  const { from, to } = monthRange(month);
  const { data, error, loading } = useLoad(() => api<HistoryData>('/attendance/history', { query: { from, to } }), [month]);
  const ot = useLoad(() => api<OtMine>('/overtime/mine', { query: { from, to } }).catch(() => null), [month]);
  const otBy = new Map((ot.data?.days ?? []).map((d) => [d.workDate, d]));
  const confirm = useConfirm();
  const toast = useToast();
  const addReason = async (workDate: string, current: string | null) => {
    const reason = await confirm({ title: t('Reason for overtime'), message: t('Tell your manager why you worked overtime on this day.'), confirm: t('Send'), input: { label: t('Reason'), placeholder: current ?? t('e.g. Finishing the stock count'), required: true } });
    if (!reason) return;
    try {
      await api('/overtime/reason', { body: { workDate, reason } });
      toast(t('Reason sent'));
      ot.reload();
    } catch (e) {
      toast(tServer((e as Error).message), 'bad');
    }
  };
  const isCurrent = month >= currentMonth();
  return (
    <>
      <MobileTop title={t('Attendance history')} back={false} />
      <div className="m-page">
        <div className="row between card card-pad" style={{ padding: 8 }}>
          <button className="btn ghost icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t('Previous month')}><Icon name="left" /></button>
          <strong>{monthLabel(month)}</strong>
          <button className="btn ghost icon" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t('Next month')}><Icon name="right" /></button>
        </div>
        {loading && <Loading />}
        <ErrorText error={error} />
        {data && !loading && (
          <>
            <div className="card stats4">
              <div><div className="n" style={{ color: 'var(--good)' }}>{data.totals.present}</div><div className="l">{t('Present')}</div></div>
              <div><div className="n" style={{ color: 'var(--warn)' }}>{data.totals.late}</div><div className="l">{t('Late')}</div></div>
              <div><div className="n" style={{ color: 'var(--bad)' }}>{data.totals.absent}</div><div className="l">{t('Absent')}</div></div>
              <div><div className="n" style={{ color: 'var(--info)' }}>{data.totals.leave}</div><div className="l">{t('Leave')}</div></div>
            </div>
            <div className="row small muted wrap" style={{ justifyContent: 'center', gap: 14 }}>
              <span>{t('Late total')} <b>{t('{n} min', { n: data.totals.lateMinutes })}</b></span>
              <span>{t('Overtime')} <b>{hm(data.totals.overtimeMinutes) || '0h'}</b></span>
              <span>{t('Worked')} <b>{hm(data.totals.workedMinutes) || '0h'}</b></span>
            </div>
            <div className="card">
              {data.days.filter((d) => d.status !== 'upcoming').length === 0 && <Empty icon="calendar">{t('No days in this month yet.')}</Empty>}
              {data.days.filter((d) => d.status !== 'upcoming').map((d) => {
                const dt = new Date(`${d.date}T00:00:00Z`);
                const cin = d.records.find((r) => r.type === 'check_in');
                const couts = d.records.filter((r) => r.type === 'check_out');
                const cout = couts[couts.length - 1];
                return (
                  <div className="day-row" key={d.date}>
                    <div className="day-date">
                      <div className="d">{dt.getUTCDate()}</div>
                      <div className="w">{lang === 'km' ? KM_DAYS[dt.getUTCDay()] : dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</div>
                    </div>
                    <div className="grow">
                      {d.records.length ? (
                        <div className="day-times">{time12(cin?.time)} <span className="faint">→</span> {time12(cout?.time)}</div>
                      ) : (
                        <div className="faint">{d.holiday ?? (d.leaveType ? t('Leave ({type})', { type: LEAVE_TYPES[d.leaveType] ?? d.leaveType }) : d.status === 'day_off' ? t('Day off') : '—')}</div>
                      )}
                      <div className="faint small">
                        {[d.lateMinutes ? t('Late {n} min', { n: d.lateMinutes }) : '', d.overtimeMinutes ? t('OT {n} min', { n: d.overtimeMinutes }) : '', ...d.flags.filter((f) => f !== 'overtime').map((f) => FLAG_LABEL[f])].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="stack tight" style={{ alignItems: 'flex-end' }}>
                      <DayBadge status={d.status} />
                      {ot.data?.requiresApproval && otBy.get(d.date) && (() => {
                        const o = otBy.get(d.date)!;
                        const tone = o.status === 'approved' ? 'good' : o.status === 'rejected' ? 'bad' : 'warn';
                        return (
                          <>
                            <Badge tone={tone}>{o.status === 'approved' ? t('OT approved {n} min', { n: o.countedMinutes }) : o.status === 'pending' ? t('OT pending') : o.status === 'rejected' ? t('OT rejected') : `OT ${o.status}`}</Badge>
                            {o.status === 'pending' && (
                              <button className="btn sm ghost" style={{ height: 24, padding: '0 6px' }} onClick={() => addReason(d.date, o.reason)}>
                                {o.reason ? t('Edit reason') : t('Add reason')}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
