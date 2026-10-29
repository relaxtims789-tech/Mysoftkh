import { Link, useParams } from 'react-router-dom';
import { api, download } from '../lib/api';
import { monthLabel } from '../lib/format';
import { t } from '../lib/i18n';
import { money, PayLine, PayrollRun } from '../lib/payroll';
import { Icon } from '../components/Icon';
import { PayslipView } from '../components/Payslip';
import { Badge, Empty, ErrorText, Loading, useAction, useLoad } from '../components/ui';
import { MobileTop } from './EmployeeApp';

interface Mine { month: string; status: 'approved' | 'paid'; currency: string; paidAt: string | null; gross: number; net: number }

export function PayslipsScreen() {
  const { data, error, loading } = useLoad(() => api<Mine[]>('/payroll/mine'), []);
  return (
    <>
      <MobileTop title={t('Payslips')} />
      <div className="m-page">
        {loading && <Loading />}
        <ErrorText error={error} />
        {data && (
          <div className="card">
            {data.length === 0 && <Empty icon="money">{t("No payslips yet. They appear here once HR approves the month's payroll.")}</Empty>}
            {data.map((p) => (
              <Link key={p.month} className="day-row" to={`/app/payslips/${p.month}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <Icon name="money" />
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>{monthLabel(p.month)}</div>
                  <div className="faint small">{t('Gross {amount}', { amount: money(p.gross, p.currency) })}</div>
                </div>
                <div className="stack tight" style={{ alignItems: 'flex-end' }}>
                  <b>{money(p.net, p.currency)} {p.currency}</b>
                  <Badge tone={p.status === 'paid' ? 'good' : 'info'}>{p.status === 'paid' ? t('Paid') : t('Approved')}</Badge>
                </div>
                <Icon name="right" size={16} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function PayslipScreen() {
  const { month = '' } = useParams();
  const { data, error, loading } = useLoad(() => api<{ run: PayrollRun; line: PayLine }>(`/payroll/mine/${month}`), [month]);
  const { busy, run, error: dlError } = useAction();
  return (
    <>
      <MobileTop title={month ? monthLabel(month) : t('Payslip')} />
      <div className="m-page">
        {loading && <Loading />}
        <ErrorText error={error || dlError} />
        {data && (
          <>
            <div className="card card-pad">
              <PayslipView line={data.line} currency={data.run.currency} exchangeRate={data.run.exchangeRate} />
            </div>
            <button className="btn block lg" disabled={busy} onClick={() => run(() => download(`/payroll/mine/${month}/pdf`, undefined, `payslip-${month}.pdf`))}>
              <Icon name="download" /> {busy ? t('Preparing…') : t('Download PDF')}
            </button>
            <p className="faint small center">{t('Questions about your pay? Contact HR.')}</p>
          </>
        )}
      </div>
    </>
  );
}
