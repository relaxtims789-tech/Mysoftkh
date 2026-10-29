import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isAdmin, useAuth } from '../lib/auth';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, Avatar, Badge, Empty, ErrorText, Field, Loading, Modal, Pager, Switch, useAction, useLoad } from '../components/ui';
import { invalidateRefs, PageHead, Select, useBranches, useDepartments, usePositions, useSchedules } from './shared';

export interface Employee {
  id: string; employeeCode: string; name: string; phone: string | null; email: string | null; departmentId: string | null; department: string | null;
  positionId: string | null; position: string | null; branchId: string | null; branch: string | null; scheduleId: string | null; schedule: string | null;
  status: string; profilePhoto: string | null; hiredOn: string | null; monthlySalary?: number | null; hourlyRate?: number | null;
  dependents?: number; taxResident?: boolean; nssfEnrolled?: boolean; bankName?: string | null; bankAccount?: string | null; bankAccountName?: string | null; device: { status: string; name: string | null; lastUsedAt: string | null } | null; pendingDevices: number;
}

export function Employees() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState({ search: '', departmentId: '', branchId: '', status: 'active', page: 1 });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const branches = useBranches();
  const departments = useDepartments();
  const { data, error, loading, reload } = useLoad(() => api<{ items: Employee[]; total: number; page: number; pageSize: number }>('/employees', { query: { ...q, pageSize: 50 } }), [q]);
  const set = (k: keyof typeof q, v: string | number) => setQ((s) => ({ ...s, [k]: v, page: k === 'page' ? (v as number) : 1 }));
  const admin = isAdmin(user);

  return (
    <>
      <PageHead title={t('Employees')} sub={data ? t(q.status === 'active' ? '{n} active employees' : q.status === 'inactive' ? '{n} inactive employees' : '{n} employees', { n: data.total }) : ''}>
        {admin && <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" size={16} /> {t('Import CSV')}</button>}
        {admin && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> {t('Add employee')}</button>}
      </PageHead>
      <div className="card">
        <div className="toolbar" style={{ padding: 12 }}>
          <div className="search"><Icon name="search" size={16} /><input className="input" placeholder={t('Name, ID, phone, email')} value={q.search} onChange={(e) => set('search', e.target.value)} /></div>
          <Select value={q.departmentId} onChange={(v) => set('departmentId', v)} options={departments} placeholder={t('All departments')} />
          <Select value={q.branchId} onChange={(v) => set('branchId', v)} options={branches} placeholder={t('All branches')} />
          <select className="select" value={q.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">{t('Active')}</option><option value="inactive">{t('Disabled')}</option><option value="all">{t('All')}</option>
          </select>
        </div>
        <ErrorText error={error} />
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Department')}</th><th>{t('Position')}</th><th>{t('Branch')}</th><th>{t('Phone')}</th><th>{t('Registered phone')}</th><th>{t('Status')}</th></tr></thead>
              <tbody>
                {data?.items.length === 0 && <tr><td colSpan={7}><Empty icon="users">{t('No employees found.')}</Empty></td></tr>}
                {data?.items.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/admin/employees/${e.id}`)}>
                    <td>
                      <div className="row">
                        <Avatar name={e.name} photo={e.profilePhoto} />
                        <span><span style={{ fontWeight: 600 }}>{e.name}</span><br /><span className="faint small">{e.employeeCode}</span></span>
                      </div>
                    </td>
                    <td>{e.department ?? '—'}</td>
                    <td>{e.position ?? '—'}</td>
                    <td>{e.branch ?? '—'}</td>
                    <td className="nowrap">{e.phone ?? '—'}</td>
                    <td>
                      {e.device ? <span className="small">{e.device.name ?? t('Phone')}</span> : <span className="faint small">{t('None')}</span>}
                      {e.pendingDevices > 0 && <> <Badge tone="warn">{t('{n} pending', { n: e.pendingDevices })}</Badge></>}
                    </td>
                    <td><Badge tone={e.status === 'active' ? 'good' : 'muted'}>{e.status === 'active' ? t('Active') : t('Disabled')}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set('page', p)} />}
      </div>
      {adding && <EmployeeForm onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); if (id) navigate(`/admin/employees/${id}`); else reload(); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); invalidateRefs(); reload(); }} />}
    </>
  );
}

/** Add / edit an employee. On create, shows the log-in details to hand to the employee. */
export function EmployeeForm({ employee, onClose, onSaved }: { employee?: Employee; onClose: () => void; onSaved: (id?: string) => void }) {
  const [f, setF] = useState({
    employeeCode: employee?.employeeCode ?? '', name: employee?.name ?? '', phone: employee?.phone ?? '', email: employee?.email ?? '',
    departmentId: employee?.departmentId ?? '', positionId: employee?.positionId ?? '', branchId: employee?.branchId ?? '',
    scheduleId: employee?.scheduleId ?? '', hiredOn: employee?.hiredOn ?? '',
    monthlySalary: employee?.monthlySalary != null ? String(employee.monthlySalary) : '', hourlyRate: employee?.hourlyRate != null ? String(employee.hourlyRate) : '',
    dependents: String(employee?.dependents ?? 0), bankName: employee?.bankName ?? '', bankAccount: employee?.bankAccount ?? '', bankAccountName: employee?.bankAccountName ?? '',
  });
  const [taxResident, setTaxResident] = useState(employee?.taxResident ?? true);
  const [nssfEnrolled, setNssfEnrolled] = useState(employee?.nssfEnrolled ?? true);
  const [created, setCreated] = useState<{ id: string; companyCode: string; username: string; temporaryPassword?: string } | null>(null);
  const departments = useDepartments();
  const positions = usePositions();
  const branches = useBranches();
  const schedules = useSchedules();
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() === '' ? (employee ? null : undefined) : v.trim()]));
    for (const k of ['monthlySalary', 'hourlyRate', 'dependents']) if (typeof body[k] === 'string') body[k] = Number(body[k]);
    if (body.dependents == null) body.dependents = 0;
    body.taxResident = taxResident;
    body.nssfEnrolled = nssfEnrolled;
    if (employee) {
      const r = await run(() => api(`/employees/${employee.id}`, { method: 'PUT', body }), t('Employee saved'));
      if (r) onSaved();
    } else {
      const r = await run(() => api('/employees', { body }));
      if (r) setCreated({ id: r.employee.id, ...r.login });
    }
  }

  if (created) {
    return (
      <Modal title={t('Employee added')} onClose={() => onSaved(created.id)} footer={<button className="btn primary" onClick={() => onSaved(created.id)}>{t('Done')}</button>}>
        <div className="stack">
          <Alert tone="good">{t('Give these sign-in details to the employee. They must choose a new password at first sign-in.')}</Alert>
          <dl className="kv">
            <dt>{t('App address')}</dt><dd>{location.origin}/app</dd>
            <dt>{t('Company code')}</dt><dd className="mono">{created.companyCode}</dd>
            <dt>{t('Employee ID')}</dt><dd className="mono">{created.username}</dd>
            {created.temporaryPassword && (<><dt>{t('Temporary password')}</dt><dd className="mono">{created.temporaryPassword}</dd></>)}
          </dl>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={employee ? t('Edit employee') : t('Add employee')} onClose={onClose} wide footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" form="emp-form" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
      </>
    }>
      <form id="emp-form" className="stack" onSubmit={submit}>
        <div className="grid2">
          <Field label={t('Employee ID')} htmlFor="ec"><input id="ec" className="input" value={f.employeeCode} onChange={(e) => set('employeeCode')(e.target.value)} required maxLength={40} /></Field>
          <Field label={t('Full name')} htmlFor="en"><input id="en" className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} required maxLength={120} /></Field>
          <Field label={t('Phone')} htmlFor="ep"><input id="ep" className="input" value={f.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="+855 12 345 678" /></Field>
          <Field label={t('Email')} htmlFor="ee"><input id="ee" type="email" className="input" value={f.email} onChange={(e) => set('email')(e.target.value)} /></Field>
          <Field label={t('Department')} htmlFor="ed"><Select id="ed" value={f.departmentId} onChange={set('departmentId')} options={departments.filter((d) => d.status === 'active' || d.id === f.departmentId)} placeholder="—" /></Field>
          <Field label={t('Position')} htmlFor="eo"><Select id="eo" value={f.positionId} onChange={set('positionId')} options={positions.filter((d) => d.status === 'active' || d.id === f.positionId)} placeholder="—" /></Field>
          <Field label={t('Branch')} htmlFor="eb" hint={t('Where the employee normally works.')}><Select id="eb" value={f.branchId} onChange={set('branchId')} options={branches.filter((b) => b.status === 'active' || b.id === f.branchId)} placeholder="—" /></Field>
          <Field label={t('Work schedule')} htmlFor="es"><Select id="es" value={f.scheduleId} onChange={set('scheduleId')} options={schedules.filter((s) => s.status === 'active')} placeholder={t('Company default')} /></Field>
          <Field label={t('Hire date')} htmlFor="eh"><input id="eh" type="date" className="input" value={f.hiredOn} onChange={(e) => set('hiredOn')(e.target.value)} /></Field>
          <Field label={t('Monthly salary')} htmlFor="esal" hint={t('Used for payroll and overtime. Visible to admins and HR only.')}><input id="esal" type="number" min={0} step={0.01} className="input" value={f.monthlySalary} onChange={(e) => set('monthlySalary')(e.target.value)} placeholder={t('e.g. 450')} /></Field>
          <Field label={t('Hourly rate (optional)')} htmlFor="erate" hint={t('Overrides salary ÷ hours per month.')}><input id="erate" type="number" min={0} step={0.01} className="input" value={f.hourlyRate} onChange={(e) => set('hourlyRate')(e.target.value)} /></Field>
        </div>
        <h3 style={{ margin: '8px 0 0' }}>{t('Payroll')}</h3>
        <div className="grid2">
          <Field label={t('Dependants for tax')} htmlFor="edep" hint={t('Non-working spouse and children (Tax on Salary allowance).')}><input id="edep" type="number" min={0} max={20} className="input" value={f.dependents} onChange={(e) => set('dependents')(e.target.value)} /></Field>
          <Field label={t('Tax status')} htmlFor="eres">
            <select id="eres" className="select" value={taxResident ? 'yes' : 'no'} onChange={(e) => setTaxResident(e.target.value === 'yes')}>
              <option value="yes">{t('Resident (progressive rates)')}</option><option value="no">{t('Non-resident (flat rate)')}</option>
            </select>
          </Field>
          <Field label={t('Bank')} htmlFor="ebank"><input id="ebank" className="input" list="bank-names" value={f.bankName} onChange={(e) => set('bankName')(e.target.value)} placeholder={t('e.g. ABA Bank')} maxLength={80} />
            <datalist id="bank-names">{['ABA Bank', 'ACLEDA Bank', 'Wing Bank', 'Canadia Bank', 'Prince Bank', 'Sathapana Bank', 'Chip Mong Bank', 'FTB Bank'].map((b) => <option key={b} value={b} />)}</datalist>
          </Field>
          <Field label={t('Account number')} htmlFor="eacc" hint={t('Empty = paid in cash.')}><input id="eacc" className="input" value={f.bankAccount} onChange={(e) => set('bankAccount')(e.target.value)} maxLength={40} /></Field>
          <Field label={t('Account name')} htmlFor="eaccn"><input id="eaccn" className="input" value={f.bankAccountName} onChange={(e) => set('bankAccountName')(e.target.value)} maxLength={120} /></Field>
          <div style={{ alignSelf: 'end', paddingBottom: 8 }}><Switch checked={nssfEnrolled} onChange={setNssfEnrolled} label={t('Pays NSSF')} /></div>
        </div>
        {!employee && <p className="faint small">{t('A log-in is created with the employee ID and a temporary password.')}</p>}
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}

/** CSV import: Employee ID, Name, Phone, Email, Department, Position, Branch (header row required). */
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [password, setPassword] = useState('');
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const { busy, error, run } = useAction();

  async function onFile(file: File) {
    setParseError('');
    const text = (await file.text()).replace(/^﻿/, '');
    const lines = parseCsv(text).filter((r) => r.some((c) => c.trim()));
    if (lines.length < 2) return setParseError(t('The file has no data rows.'));
    const header = lines[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const idx = { employeeCode: col('employeeid', 'employeecode', 'id', 'code'), name: col('name', 'fullname'), phone: col('phone', 'mobile'), email: col('email'), department: col('department'), position: col('position', 'title'), branch: col('branch', 'branchcode') };
    if (idx.employeeCode < 0 || idx.name < 0) return setParseError(t('The header row must include "Employee ID" and "Name".'));
    setRows(lines.slice(1).map((r) => Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0).map(([k, i]) => [k, (r[i] ?? '').trim()])).valueOf()));
  }

  return (
    <Modal title={t('Import employees')} onClose={onClose} wide footer={
      result ? <button className="btn primary" onClick={onDone}>{t('Done')}</button> : (
        <>
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" disabled={!rows || busy || password.length < 8} onClick={async () => {
            const r = await run(() => api('/employees/import', { body: { rows: rows!.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== ''))), initialPassword: password } }));
            if (r) setResult(r);
          }}>{busy ? t('Importing…') : t('Import {n} rows', { n: rows?.length ?? '' })}</button>
        </>
      )
    }>
      {result ? (
        <Alert tone="good">{t('{created} employees added, {updated} updated.', { created: result.created, updated: result.updated })}</Alert>
      ) : (
        <div className="stack">
          <p className="muted">{t('Use a CSV file with a header row:')} <span className="mono">Employee ID, Name, Phone, Email, Department, Position, Branch</span>. {t('Existing employee IDs are updated; new departments and positions are created. Branch is the branch code or name.')}</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {parseError && <Alert tone="bad">{parseError}</Alert>}
          {rows && (
            <>
              <div className="table-wrap card" style={{ maxHeight: 220 }}>
                <table className="table">
                  <thead><tr><th>{t('ID')}</th><th>{t('Name')}</th><th>{t('Department')}</th><th>{t('Position')}</th><th>{t('Branch')}</th></tr></thead>
                  <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i}><td>{r.employeeCode}</td><td>{r.name}</td><td>{r.department}</td><td>{r.position}</td><td>{r.branch}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="faint small">{t(rows.length > 8 ? '{n} rows (first 8 shown).' : '{n} rows.', { n: rows.length })}</p>
              <Field label={t('Initial password for new employees')} hint={t('At least 8 characters with a letter and a number. Employees must change it at first sign-in.')}>
                <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </>
          )}
          <ErrorText error={error} />
        </div>
      )}
    </Modal>
  );
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
