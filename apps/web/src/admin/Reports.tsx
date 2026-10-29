import { useState } from 'react';
import { api, download } from '../lib/api';
import { todayIso } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Empty, ErrorText, Field, Loading, useAction } from '../components/ui';
import { PageHead, Select, useBranches, useDepartments } from './shared';

interface Report {
  type: string; title: string; subtitle: string; companyName: string;
  columns: { key: string; label: string; align?: 'left' | 'right' | 'center' }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
}

const TYPES: { key: string; title: string; desc: string; period: 'day' | 'range' }[] = [
  { key: 'daily', title: t('Daily attendance'), desc: t('Everyone, one day'), period: 'day' },
  { key: 'monthly', title: t('Monthly summary'), desc: t('Per employee totals (payroll)'), period: 'range' },
  { key: 'employee', title: t('Employee'), desc: t('One person, day by day'), period: 'range' },
  { key: 'department', title: t('By department'), desc: t('Rates per department'), period: 'range' },
  { key: 'branch', title: t('By branch'), desc: t('Rates per branch'), period: 'range' },
  { key: 'late', title: t('Late employees'), desc: t('Every late arrival'), period: 'range' },
  { key: 'absent', title: t('Absent employees'), desc: t('Every absence'), period: 'range' },
  { key: 'early-leave', title: t('Early leave'), desc: t('Left before end time'), period: 'range' },
  { key: 'overtime', title: t('Overtime'), desc: t('Each OT day, approval, pay'), period: 'range' },
  { key: 'overtime-pay', title: t('Overtime pay'), desc: t('Payroll: OT hours, days and pay'), period: 'range' },
  { key: 'leave', title: t('Leave'), desc: t('Approved and pending'), period: 'range' },
  { key: 'exceptions', title: t('Exceptions'), desc: t('Missing scans, suspicious, rejected'), period: 'range' },
];

export function Reports() {
  const [type, setType] = useState('daily');
  const today = todayIso();
  const [q, setQ] = useState({ date: today, from: `${today.slice(0, 7)}-01`, to: today, departmentId: '', branchId: '', employeeId: '' });
  const [empSearch, setEmpSearch] = useState('');
  const [empResults, setEmpResults] = useState<{ id: string; name: string; employeeCode: string }[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const { busy, error, run } = useAction();
  const branches = useBranches();
  const departments = useDepartments();
  const def = TYPES.find((x) => x.key === type)!;

  const params = () => ({
    ...(def.period === 'day' ? { date: q.date } : { from: q.from, to: q.to }),
    departmentId: q.departmentId, branchId: q.branchId, employeeId: type === 'employee' ? q.employeeId : undefined,
  });
  const view = () => run(async () => setReport(await api<Report>(`/reports/${type}`, { query: params() })));
  const exportAs = (format: string) => run(() => download('/reports/export', { type, format, ...params() }));

  return (
    <>
      <PageHead title={t('Reports')} sub={t('View on screen, or download as Excel, CSV or PDF.')} />
      <div className="report-types">
        {TYPES.map((x) => (
          <button key={x.key} className={`report-type${type === x.key ? ' on' : ''}`} onClick={() => { setType(x.key); setReport(null); }}>
            <b>{x.title}</b><span>{x.desc}</span>
          </button>
        ))}
      </div>
      <div className="card card-pad">
        <div className="toolbar" style={{ alignItems: 'flex-end' }}>
          {def.period === 'day' ? (
            <Field label={t('Date')}><input type="date" className="input" value={q.date} max={today} onChange={(e) => setQ({ ...q, date: e.target.value })} /></Field>
          ) : (
            <>
              <Field label={t('From')}><input type="date" className="input" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></Field>
              <Field label={t('To')}><input type="date" className="input" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></Field>
            </>
          )}
          {type === 'employee' ? (
            <Field label={t('Employee')}>
              <div style={{ position: 'relative' }}>
                <input className="input" style={{ minWidth: 240 }} value={empSearch} placeholder={t('Search name or ID')}
                  onChange={async (e) => {
                    setEmpSearch(e.target.value);
                    setQ((s) => ({ ...s, employeeId: '' }));
                    if (e.target.value.trim().length >= 2) setEmpResults((await api('/employees', { query: { search: e.target.value, pageSize: 8 } })).items);
                    else setEmpResults([]);
                  }} />
                {!q.employeeId && empResults.length > 0 && (
                  <div className="menu" style={{ left: 0, right: 'auto', width: '100%' }}>
                    {empResults.map((e) => (
                      <button key={e.id} onClick={() => { setQ((s) => ({ ...s, employeeId: e.id })); setEmpSearch(`${e.name} (${e.employeeCode})`); setEmpResults([]); }}>{e.name} <span className="faint small">{e.employeeCode}</span></button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          ) : (
            <>
              <Field label={t('Department')}><Select value={q.departmentId} onChange={(v) => setQ({ ...q, departmentId: v })} options={departments} placeholder={t('All')} /></Field>
              {type !== 'department' && <Field label={t('Branch')}><Select value={q.branchId} onChange={(v) => setQ({ ...q, branchId: v })} options={branches} placeholder={t('All')} /></Field>}
            </>
          )}
          <button className="btn primary" onClick={view} disabled={busy || (type === 'employee' && !q.employeeId)}><Icon name="eye" size={16} /> {t('View')}</button>
          <div className="grow" />
          <button className="btn" onClick={() => exportAs('xlsx')} disabled={busy || (type === 'employee' && !q.employeeId)}><Icon name="download" size={16} /> Excel</button>
          <button className="btn" onClick={() => exportAs('csv')} disabled={busy || (type === 'employee' && !q.employeeId)}>CSV</button>
          <button className="btn" onClick={() => exportAs('pdf')} disabled={busy || (type === 'employee' && !q.employeeId)}>PDF</button>
        </div>
      </div>
      <ErrorText error={error} />
      {busy && !report && <Loading />}
      {report && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{tServer(report.title)}</h2>
              <div className="faint small">{report.companyName} · {tServer(report.subtitle)} · {t(report.rows.length === 1 ? '{n} row' : '{n} rows', { n: report.rows.length })}</div>
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: '65vh' }}>
            <table className="table">
              <thead><tr>{report.columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'num' : ''}>{tServer(c.label)}</th>)}</tr></thead>
              <tbody>
                {report.rows.length === 0 && <tr><td colSpan={report.columns.length}><Empty icon="file">{t('No records for this period.')}</Empty></td></tr>}
                {report.rows.map((r, i) => (
                  <tr key={i}>{report.columns.map((c) => <td key={c.key} className={`nowrap ${c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : ''}`}>{r[c.key] ?? ''}</td>)}</tr>
                ))}
                {report.totals && report.rows.length > 0 && (
                  <tr>{report.columns.map((c, i) => <td key={c.key} className={c.align === 'right' ? 'num' : ''} style={{ fontWeight: 700 }}>{i === 0 ? t('Total') : report.totals![c.key] ?? ''}</td>)}</tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
