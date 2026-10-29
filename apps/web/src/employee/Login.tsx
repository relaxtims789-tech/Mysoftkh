import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, login, logout, reloadMe } from '../lib/api';
import { useAuth } from '../lib/auth';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Alert, ErrorText, Field, useAction } from '../components/ui';
import { InAppWarning, tx } from '../components/PhoneHelp';
import { BrandLockup } from '../components/Brand';
import { LangSwitch } from '../components/LangSwitch';
import { DemoLoginCard } from '../components/Demo';
import { useDemo } from '../lib/demo';
import { isMiniApp, requestWriteAccess, telegramInitData } from '../lib/telegram';

function remembered(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export function PasswordInput({ value, onChange, autoComplete, id, placeholder }: { value: string; onChange: (v: string) => void; autoComplete: string; id?: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} className="input lg" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} required />
      <button type="button" className="btn ghost icon" onClick={() => setShow(!show)} aria-label={show ? t('Hide password') : t('Show password')}>
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  );
}

/** Employee sign-in: company code (remembered), employee ID, password. */
export function LoginScreen({ next, scanToken }: { next?: string; scanToken?: string }) {
  const [companyCode, setCompanyCode] = useState(() => remembered('qra.companyCode'));
  const [loginId, setLoginId] = useState(() => remembered('qra.employeeId'));
  const [password, setPassword] = useState('');
  const [branch, setBranch] = useState<{ valid: boolean; branchName?: string; companyName?: string; companyCode?: string; message?: string } | null>(null);
  const { busy, error, run } = useAction();
  const navigate = useNavigate();
  const demo = useDemo();

  useEffect(() => {
    if (!scanToken) return;
    api(`/qr/resolve/${encodeURIComponent(scanToken)}`).then((r) => {
      setBranch(r);
      if (r.companyCode) setCompanyCode((c) => c || r.companyCode);
    }).catch(() => undefined);
  }, [scanToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const s = await run(() => login({ companyCode: companyCode.trim() || undefined, login: loginId.trim(), password }));
    if (!s) return;
    remember('qra.companyCode', companyCode.trim());
    remember('qra.employeeId', loginId.trim());
    // Inside Telegram: connect this Telegram account so it signs in by itself next time, and allow messages.
    if (isMiniApp() && telegramInitData()) {
      api('/auth/telegram/link', { body: { initData: telegramInitData() } }).then(() => requestWriteAccess()).catch(() => undefined);
    }
    if (!s.user.employee && s.user.role !== 'employee') navigate('/admin', { replace: true });
    else if (next) navigate(next, { replace: true });
  }

  return (
    <form className="auth-page" onSubmit={submit}>
      <LangSwitch style={{ position: 'absolute', top: 'calc(10px + env(safe-area-inset-top))', right: 12 }} />
      <BrandLockup center sub={t('Sign in to record your attendance')} />
      <InAppWarning />
      {isMiniApp() && <Alert tone="info">{tx('Sign in {0}. Next time Telegram signs you in by itself.', <b>{t('once')}</b>)}</Alert>}
      {branch?.valid && (
        <Alert tone="info">
          {tx('You scanned the QR at {0} ({1}). Sign in to continue.', <b>{branch.branchName}</b>, branch.companyName)}
        </Alert>
      )}
      {branch && !branch.valid && <Alert tone="bad">{tServer(branch.message)}</Alert>}
      {demo && <DemoLoginCard demo={demo} kind="app" onUse={() => { setCompanyCode(demo.companyCode ?? ''); setLoginId(demo.employeeId ?? ''); setPassword(demo.password ?? ''); }} />}
      <Field label={t('Company code')} htmlFor="cc">
        <input id="cc" className="input lg" value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="organization" placeholder={t('e.g. {example}', { example: 'camdemo' })} />
      </Field>
      <Field label={t('Employee ID or phone number')} htmlFor="eid">
        <input id="eid" className="input lg" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder={t('e.g. {id} or {phone}', { id: 'E0001', phone: '012 345 678' })} required />
      </Field>
      <Field label={t('Password')} htmlFor="pw">
        <PasswordInput id="pw" value={password} onChange={setPassword} autoComplete="current-password" />
      </Field>
      <ErrorText error={error} />
      <button className="btn primary lg block" disabled={busy}>{busy ? t('Signing in…') : t('Sign in')}</button>
      <p className="faint small center">{t('Forgot your password? Ask HR to reset it.')} · <a href="/admin">{t('Staff sign-in')}</a></p>
    </form>
  );
}

/** Required after a temporary password, or opened from Profile. */
export function ChangePassword({ voluntary }: { voluntary?: boolean }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, run, setError } = useAction();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return setError(new Error(t('The new passwords do not match.')));
    const ok = await run(() => api('/auth/password', { method: 'PUT', body: { currentPassword: current, newPassword: next } }), t('Password changed'));
    if (ok) {
      await reloadMe();
      if (voluntary) navigate(-1);
    }
  }

  return (
    <form className="auth-page" onSubmit={submit}>
      <div className="brand">
        <div className="brand-mark"><Icon name="key" size={24} /></div>
        <div>
          <h1>{voluntary ? t('Change password') : t('Set your password')}</h1>
          <div className="muted">{voluntary ? user?.name : t('Welcome, {name}. Replace your temporary password to continue.', { name: user?.name })}</div>
        </div>
      </div>
      <Field label={voluntary ? t('Current password') : t('Temporary password')} htmlFor="cur">
        <PasswordInput id="cur" value={current} onChange={setCurrent} autoComplete="current-password" />
      </Field>
      <Field label={t('New password')} htmlFor="new" hint={t('At least 8 characters with a letter and a number.')}>
        <PasswordInput id="new" value={next} onChange={setNext} autoComplete="new-password" />
      </Field>
      <Field label={t('Repeat new password')} htmlFor="again">
        <PasswordInput id="again" value={again} onChange={setAgain} autoComplete="new-password" />
      </Field>
      <ErrorText error={error} />
      <button className="btn primary lg block" disabled={busy}>{busy ? t('Saving…') : t('Save password')}</button>
      {voluntary ? (
        <button type="button" className="btn ghost block" onClick={() => navigate(-1)}>{t('Cancel')}</button>
      ) : (
        <button type="button" className="btn ghost block" onClick={() => logout()}>{t('Sign out')}</button>
      )}
    </form>
  );
}
