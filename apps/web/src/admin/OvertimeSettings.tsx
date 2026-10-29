import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { ErrorText, Field, Loading, Switch, useAction, useLoad } from '../components/ui';

type Mode = 'multiplier' | 'fixed_hour' | 'fixed_day';
interface Rule { mode: Mode; value: number; minHours: number }
interface Policy { requiresApproval: boolean; currency: string; monthlyHours: number; workDay: Rule; dayOff: Rule; holiday: Rule }

const MODE_LABEL: Record<Mode, string> = {
  multiplier: t('Per hour: × hourly rate'),
  fixed_hour: t('Per hour: fixed amount'),
  fixed_day: t('Per day: fixed amount'),
};

function RuleEditor({ title, hint, rule, onChange, allowDay, currency, disabled }: {
  title: string; hint: string; rule: Rule; onChange: (r: Rule) => void; allowDay: boolean; currency: string; disabled: boolean;
}) {
  const modes: Mode[] = allowDay ? ['multiplier', 'fixed_hour', 'fixed_day'] : ['multiplier', 'fixed_hour'];
  return (
    <div className="card card-pad stack tight" style={{ boxShadow: 'none' }}>
      <strong>{title}</strong>
      <span className="faint small">{hint}</span>
      <div className="grid3" style={{ alignItems: 'end' }}>
        <Field label={t('Paid')}>
          <select className="select" value={rule.mode} disabled={disabled} onChange={(e) => onChange({ ...rule, mode: e.target.value as Mode })}>
            {modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        </Field>
        <Field label={rule.mode === 'multiplier' ? t('Multiplier') : rule.mode === 'fixed_hour' ? t('{currency} per OT hour', { currency }) : t('{currency} per day', { currency })}>
          <input className="input" type="number" min={0} step={0.01} value={rule.value} disabled={disabled} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} />
        </Field>
        {rule.mode === 'fixed_day' && (
          <Field label={t('Minimum hours worked')}>
            <input className="input" type="number" min={0} max={24} step={0.5} value={rule.minHours} disabled={disabled} onChange={(e) => onChange({ ...rule, minHours: Number(e.target.value) })} />
          </Field>
        )}
      </div>
    </div>
  );
}

/** Settings → Overtime: pay rates per hour (work days) and per hour or per day (days off, holidays), and approval. */
export function OvertimeSettingsCard({ canEdit }: { canEdit: boolean }) {
  const { data, setData } = useLoad(() => api<Policy>('/overtime/policy'), []);
  const [f, setF] = useState<Policy | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  const disabled = !canEdit;
  const exampleRate = 416 / (f.monthlyHours || 208);
  const example = f.workDay.mode === 'multiplier' ? exampleRate * f.workDay.value : f.workDay.value;

  return (
    <div className="card">
      <div className="card-head"><h2>{t('Overtime pay & approval')}</h2></div>
      <div className="card-body stack" style={{ gap: 16 }}>
        <Switch
          checked={f.requiresApproval}
          disabled={disabled}
          onChange={(v) => setF({ ...f, requiresApproval: v })}
          label={t('Overtime needs approval')}
          hint={t("When on, overtime counts for pay only after HR, an admin or the employee's manager approves it (they can approve fewer minutes). Employees can add a reason on their phone.")}
        />
        <div className="grid3">
          <Field label={t('Currency')}>
            <select className="select" value={f.currency} disabled={disabled} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {['USD', 'KHR', 'THB', 'VND'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label={t('Hours per month')} hint={t("Hourly rate = monthly salary ÷ this (26 days × 8 h = 208). An employee's own hourly rate overrides it.")}>
            <input className="input" type="number" min={1} max={400} step={0.5} value={f.monthlyHours} disabled={disabled} onChange={(e) => setF({ ...f, monthlyHours: Number(e.target.value) })} />
          </Field>
        </div>
        <RuleEditor title={t('Normal work days')} hint={t('Time after the end of work (minimum minutes are set in Attendance rules).')} rule={f.workDay} allowDay={false} currency={f.currency} disabled={disabled} onChange={(r) => setF({ ...f, workDay: r })} />
        <RuleEditor title={t('Days off')} hint={t("Work on a non-working day of the employee's schedule (e.g. Sunday). All hours worked count as overtime.")} rule={f.dayOff} allowDay currency={f.currency} disabled={disabled} onChange={(r) => setF({ ...f, dayOff: r })} />
        <RuleEditor title={t('Public holidays')} hint={t('Work on a holiday from the Holidays list. All hours worked count as overtime.')} rule={f.holiday} allowDay currency={f.currency} disabled={disabled} onChange={(r) => setF({ ...f, holiday: r })} />
        <p className="faint small">
          {t('Example: monthly salary 416 {currency} → {rate} {currency}/h. One hour of overtime on a work day pays {pay} {currency}.', { currency: f.currency, rate: exampleRate.toFixed(2), pay: example.toFixed(2) })}
        </p>
        <ErrorText error={error} />
        {canEdit && (
          <div>
            <button className="btn primary" disabled={busy} onClick={async () => {
              const r = await run(() => api<Policy>('/overtime/policy', {
                method: 'PUT',
                body: {
                  requiresApproval: f.requiresApproval, currency: f.currency, monthlyHours: f.monthlyHours,
                  workDay: { mode: f.workDay.mode, value: f.workDay.value },
                  dayOff: { mode: f.dayOff.mode, value: f.dayOff.value, minHours: f.dayOff.minHours },
                  holiday: { mode: f.holiday.mode, value: f.holiday.value, minHours: f.holiday.minHours },
                },
              }), t('Overtime settings saved'));
              if (r) setData(r);
            }}>{t('Save overtime settings')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
