import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { isAdmin, useAuth } from '../lib/auth';
import { time12 } from '../lib/format';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Badge, Empty, ErrorText, Field, Loading, Modal, useAction, useLoad } from '../components/ui';
import { invalidateRefs, PageHead, Schedule, WEEKDAYS } from './shared';

const addMin = (hhmm: string, m: number) => {
  const [h, mm] = hhmm.split(':').map(Number);
  const total = h * 60 + mm + m;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export function Schedules() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const { data, error, loading, reload } = useLoad(() => api<Schedule[]>('/schedules'), []);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  return (
    <>
      <PageHead title={t('Work schedules')} sub={t('Status is decided automatically from these rules when an employee scans.')}>
        {admin && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> {t('Add schedule')}</button>}
      </PageHead>
      <ErrorText error={error} />
      {loading && !data && <Loading />}
      <div className="grid2">
        {data?.length === 0 && <div className="card"><Empty icon="calendar">{t('No schedules.')}</Empty></div>}
        {data?.map((s) => (
          <div className="card" key={s.id}>
            <div className="card-head">
              <h2>{s.name}</h2>
              <div className="row">
                {s.isDefault && <Badge tone="primary">{t('Default')}</Badge>}
                {s.status !== 'active' && <Badge>{t('Inactive')}</Badge>}
                {admin && <button className="btn sm" onClick={() => setEditing(s)}><Icon name="edit" size={14} /> {t('Edit')}</button>}
              </div>
            </div>
            <div className="card-body">
              <dl className="kv" style={{ margin: 0 }}>
                <dt>{t('Working hours')}</dt><dd>{time12(s.startTime)} – {time12(s.endTime)}</dd>
                <dt>{t('Lunch')}</dt><dd>{s.lunchStart ? `${time12(s.lunchStart)} – ${time12(s.lunchEnd)}` : t('None')}</dd>
                <dt>{t('Late after')}</dt><dd>{time12(addMin(s.startTime, s.lateAfterMinutes))} <span className="faint">({t('{n} min', { n: s.lateAfterMinutes })})</span></dd>
                <dt>{t('Grace')}</dt><dd>{t('{n} min', { n: s.graceMinutes })} <span className="faint">({t('early check-out, lunch return')})</span></dd>
                <dt>{t('Working days')}</dt><dd>{s.workDays.map((d) => WEEKDAYS[d - 1]).join(', ')}</dd>
                <dt>{t('Employees')}</dt><dd>{s.employeeCount ?? 0}</dd>
              </dl>
            </div>
          </div>
        ))}
      </div>
      {editing && <ScheduleForm schedule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidateRefs('schedules'); reload(); }} />}
    </>
  );
}

function ScheduleForm({ schedule, onClose, onSaved }: { schedule?: Schedule; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: schedule?.name ?? '', startTime: schedule?.startTime ?? '08:00', endTime: schedule?.endTime ?? '17:00',
    lunch: schedule ? !!schedule.lunchStart : true, lunchStart: schedule?.lunchStart ?? '12:00', lunchEnd: schedule?.lunchEnd ?? '13:00',
    lateAfterMinutes: schedule?.lateAfterMinutes ?? 15, graceMinutes: schedule?.graceMinutes ?? 5, workDays: schedule?.workDays ?? [1, 2, 3, 4, 5],
    isDefault: schedule?.isDefault ?? false, status: schedule?.status ?? 'active',
  });
  const { busy, error, run } = useAction();
  const toggleDay = (d: number) => setF((s) => ({ ...s, workDays: s.workDays.includes(d) ? s.workDays.filter((x) => x !== d) : [...s.workDays, d].sort() }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: f.name, startTime: f.startTime, endTime: f.endTime, lunchStart: f.lunch ? f.lunchStart : null, lunchEnd: f.lunch ? f.lunchEnd : null,
      lateAfterMinutes: Number(f.lateAfterMinutes), graceMinutes: Number(f.graceMinutes), workDays: f.workDays, isDefault: f.isDefault, status: f.status,
    };
    const r = await run(() => (schedule ? api(`/schedules/${schedule.id}`, { method: 'PUT', body }) : api('/schedules', { body })), t('Schedule saved'));
    if (r) onSaved();
  }

  return (
    <Modal title={schedule ? t('Edit schedule') : t('Add schedule')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" form="sched-form" disabled={busy || !f.workDays.length}>{busy ? t('Saving…') : t('Save')}</button>
      </>
    }>
      <form id="sched-form" className="stack" onSubmit={submit}>
        <Field label={t('Name')} htmlFor="sn"><input id="sn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder={t('Office hours')} /></Field>
        <div className="grid2">
          <Field label={t('Work starts')} htmlFor="ss"><input id="ss" type="time" className="input" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required /></Field>
          <Field label={t('Work ends')} htmlFor="se"><input id="se" type="time" className="input" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} required /></Field>
          <Field label={t('Late after (minutes after start)')} htmlFor="sl" hint={t('Check-in after {time} is LATE.', { time: time12(addMin(f.startTime, Number(f.lateAfterMinutes) || 0)) })}>
            <input id="sl" type="number" min={0} max={240} className="input" value={f.lateAfterMinutes} onChange={(e) => setF({ ...f, lateAfterMinutes: e.target.value as any })} required />
          </Field>
          <Field label={t('Grace period (minutes)')} htmlFor="sg" hint={t('Check-out before {time} is early leave.', { time: time12(addMin(f.endTime, -(Number(f.graceMinutes) || 0))) })}>
            <input id="sg" type="number" min={0} max={120} className="input" value={f.graceMinutes} onChange={(e) => setF({ ...f, graceMinutes: e.target.value as any })} required />
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.lunch} onChange={(e) => setF({ ...f, lunch: e.target.checked })} /> {t('Lunch break')}</label>
        {f.lunch && (
          <div className="grid2">
            <Field label={t('Lunch starts')} htmlFor="ls"><input id="ls" type="time" className="input" value={f.lunchStart} onChange={(e) => setF({ ...f, lunchStart: e.target.value })} /></Field>
            <Field label={t('Lunch ends')} htmlFor="le"><input id="le" type="time" className="input" value={f.lunchEnd} onChange={(e) => setF({ ...f, lunchEnd: e.target.value })} /></Field>
          </div>
        )}
        <div className="field">
          <span className="label">{t('Working days')}</span>
          <div className="daychips">
            {WEEKDAYS.map((d, i) => <button type="button" key={d} className={f.workDays.includes(i + 1) ? 'on' : ''} onClick={() => toggleDay(i + 1)}>{d}</button>)}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> {t('Default schedule for employees without one')}</label>
        {schedule && (
          <label className="check"><input type="checkbox" checked={f.status === 'active'} onChange={(e) => setF({ ...f, status: e.target.checked ? 'active' : 'inactive' })} /> {t('Active')}</label>
        )}
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}
