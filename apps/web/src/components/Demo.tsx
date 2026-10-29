import { DemoInfo, resetTime, useDemo } from '../lib/demo';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

/** Shared demo sign-in shown on the login screens of the public demo, with a button that fills the form. */
export function DemoLoginCard({ demo, kind, onUse }: { demo: DemoInfo; kind: 'admin' | 'app'; onUse: () => void }) {
  return (
    <div className="demo-card">
      <div className="demo-card-head"><Icon name="sparkle" size={16} /> <b>{t('Live demo · 6 months of sample data')}</b></div>
      <dl>
        {kind === 'app' && <><dt>{t('Company code')}</dt><dd className="mono">{demo.companyCode}</dd><dt>{t('Employee ID')}</dt><dd className="mono">{demo.employeeId}</dd></>}
        {kind === 'admin' && <><dt>{t('Sign in as')}</dt><dd className="mono">{demo.adminLogin}</dd></>}
        <dt>{t('Password')}</dt><dd className="mono">{demo.password}</dd>
      </dl>
      <button type="button" className="btn primary block" onClick={onUse}>{t('Use the demo sign-in')}</button>
      {kind === 'admin' && (
        <p className="faint small" style={{ margin: 0 }}>
          {t('Also try HR')} <span className="mono">{demo.hrLogin}</span> {t('or a department manager')} <span className="mono">{demo.managerLogin}</span> {t('(same password).')}
          {' '}{t('Staff app:')} <a href="/app">/app</a>.
        </p>
      )}
      {kind === 'app' && <p className="faint small" style={{ margin: 0 }}>{t('Works from anywhere in the demo: the GPS area and phone approval are switched off.')}</p>}
    </div>
  );
}

/** Thin notice on every admin page of the public demo. */
export function DemoBanner() {
  const demo = useDemo();
  if (!demo) return null;
  return (
    <div className="demo-banner no-print">
      <Icon name="sparkle" size={16} />
      <span>
        <b>{t('Demo company')}</b> {t('with sample data. Try anything: it is all put back every night at {time}.', { time: resetTime(demo.resetHour) })}
      </span>
      <a className="btn sm primary" href={`${demo.mainSiteUrl}/signup`}>{t('Start your own free trial')}</a>
    </div>
  );
}
