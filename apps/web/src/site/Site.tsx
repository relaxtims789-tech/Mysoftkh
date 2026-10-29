import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import './site.css';
import { RefundPolicyText } from '../components/RefundPolicy';
import { REFUND_POLICY_DOCX } from '../lib/refund-policy';
import { api, SessionResponse, startSession } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { Icon, IconName } from '../components/Icon';
import { ErrorText, Field, Loading, useAction, useLoad } from '../components/ui';
import { PasswordInput } from '../employee/Login';
import { LOGO_SRC } from '../components/Brand';
import { useLang } from './i18n';
import { useDemo } from '../lib/demo';
import { useVisitCounter } from '../lib/visits';

interface Plans {
  appUrl: string;
  currency: string;
  trialMonths: number;
  yearlyFreeMonths: number;
  tiers: { id: string; minStaff: number; maxStaff: number; maxBranches: number | null; monthlyPrice: number; yearlyPrice: number }[];
  payment: { payway: boolean; banks: { bank: string; name: string }[] };
  contact: { phone: string | null; telegram: string | null; email: string | null; telegramQr: string | null };
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const telegramUrl = (v: string) => (/^https?:\/\//.test(v) ? v : `https://t.me/${v.replace(/^@/, '')}`);

let plansRequest: Promise<Plans> | null = null;
function usePlans() {
  return useLoad(() => (plansRequest ??= api<Plans>('/public/plans').catch((e) => { plansRequest = null; throw e; })), []);
}

/**
 * Sign-up, sign-in and the dashboard live on the app's own address (e.g. attendance.mysoftkh.com) even when this website
 * is shown on another one (e.g. mysoftkh.com): logins and registered phones belong to one address.
 */
function AppLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const { data } = usePlans();
  const { lang } = useLang();
  const demo = useDemo();
  // The demo's plans are not the real ones: free trials start on the real website.
  if (demo && to.startsWith('/signup')) return <a className={className} href={`${demo.mainSiteUrl}/signup?lang=${lang}`}>{children}</a>;
  const elsewhere = data?.appUrl && new URL(data.appUrl).origin !== location.origin;
  if (!elsewhere) return to.startsWith('/admin') ? <a className={className} href={to}>{children}</a> : <Link className={className} to={to}>{children}</Link>;
  const url = new URL(to, data!.appUrl);
  url.searchParams.set('lang', lang);
  return <a className={className} href={url.toString()}>{children}</a>;
}

function Header() {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const home = user ? (isStaff(user) && !user.employee ? '/admin' : user.role === 'employee' ? '/app' : '/admin') : null;
  return (
    <header className="s-head">
      <div className="s-wrap">
        <Link to="/" className="s-logo" aria-label={t('brand')}><img src={LOGO_SRC} alt="MySoft Attendance" /></Link>
        <nav className="s-nav">
          <a href="/#features">{t('nav.features')}</a>
          <a href="/#how">{t('nav.how')}</a>
          <a href="/#pricing">{t('nav.pricing')}</a>
          <a href="/#faq">{t('nav.faq')}</a>
          <a href="/#contact">{t('nav.contact')}</a>
        </nav>
        <span className="grow" />
        <button className="s-lang" onClick={() => setLang(lang === 'en' ? 'km' : 'en')} aria-label="Language">{t('nav.lang')}</button>
        {home ? (
          <a className="btn primary" href={home}>{t('nav.open')}</a>
        ) : (
          <>
            <AppLink className="btn ghost" to="/admin">{t('nav.signin')}</AppLink>
            <AppLink className="btn primary hide-xs" to="/signup">{t('nav.start')}</AppLink>
          </>
        )}
      </div>
    </header>
  );
}

function Footer({ plans }: { plans: Plans | null }) {
  const { t } = useLang();
  return (
    <footer className="s-foot">
      <div className="s-wrap">
        <span>{t('footer.rights', { year: String(new Date().getFullYear()) })}</span>
        <span className="row" style={{ gap: 16 }}>
          {plans?.contact.phone && <a href={`tel:${plans.contact.phone.replace(/[^0-9+]/g, '')}`}>{plans.contact.phone}</a>}
          <Link to="/refund-policy">{t('footer.refund')}</Link>
          <Link to="/terms">{t('footer.terms')}</Link>
        </span>
      </div>
    </footer>
  );
}

function PhoneMock() {
  const { t } = useLang();
  return (
    <div className="s-phone" aria-hidden="true">
      <div className="screen">
        <div className="top"><span>MySoft Attendance</span><b>{t('mock.hello')}</b></div>
        <div className="card">
          <div className="ok"><Icon name="check" size={30} stroke={3} /></div>
          <div style={{ fontWeight: 700 }}>{t('mock.ok')}</div>
          <div className="time">07:58 AM</div>
          <div className="faint small">{t('mock.where')}</div>
        </div>
        <div className="times">
          <div>{t('mock.in')}<b>07:58</b></div>
          <div>{t('mock.out')}<b>--:--</b></div>
        </div>
        <div className="btn-mock"><Icon name="logout" size={18} /> CHECK OUT</div>
      </div>
    </div>
  );
}

const FEATURES: [IconName, 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8'][] = [
  ['qr', 'f1'], ['phone', 'f2'], ['check', 'f3'], ['chart', 'f4'], ['clock', 'f5'], ['money', 'f6'], ['leave', 'f7'], ['file', 'f8'],
];

export function Pricing({ plans }: { plans: Plans }) {
  const { t } = useLang();
  const contactHref = plans.contact.telegram ? telegramUrl(plans.contact.telegram) : plans.contact.phone ? `tel:${plans.contact.phone.replace(/[^0-9+]/g, '')}` : plans.contact.email ? `mailto:${plans.contact.email}` : '/signup';
  const [yearly, setYearly] = useState(false);
  const popular = plans.tiers.find((x) => x.minStaff <= 26 && x.maxStaff >= 26)?.id;
  return (
    <>
      <div className="center">
        <div className="s-toggle" role="group">
          <button className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>{t('pricing.monthly')}</button>
          <button className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>
            {t('pricing.yearly')}{plans.yearlyFreeMonths > 0 && <span className="save">{t('pricing.yearlyFree', { free: plans.yearlyFreeMonths })}</span>}
          </button>
        </div>
      </div>
      <div className="s-prices">
        {plans.tiers.map((x) => (
          <div key={x.id} className={`s-price${x.id === popular ? ' pop' : ''}`}>
            {x.id === popular && <span className="tag">{t('pricing.popular')}</span>}
            <span className="staff">{t('pricing.staff', { min: x.minStaff, max: x.maxStaff })}</span>
            <span className="branches"><Icon name="building" size={14} /> {x.maxBranches == null ? t('pricing.branchesUnlimited') : x.maxBranches === 1 ? t('pricing.branch1') : t('pricing.branches', { n: x.maxBranches })}</span>
            <span className="amount">{usd(yearly ? x.yearlyPrice : x.monthlyPrice)} <small>{yearly ? t('pricing.perYear') : t('pricing.perMonth')}</small></span>
            <span className="sub">{yearly ? `≈ ${usd(Math.round((x.yearlyPrice / 12) * 100) / 100)} ${t('pricing.perMonth')}` : ''}</span>
            <AppLink className={`btn ${x.id === popular ? 'primary' : ''}`} to={`/signup?plan=${x.id}`}>{t('pricing.choose')}</AppLink>
          </div>
        ))}
        <div className="s-price">
          <span className="staff">{t('pricing.bigTitle')}</span>
          <span className="amount" style={{ fontSize: 24 }}>{t('pricing.bigPrice')}</span>
          <span className="sub" />
          <a className="btn" href={contactHref}>{t('pricing.contact')}</a>
        </div>
      </div>
      <p className="s-paynote">{t('pricing.pay')}</p>
      <div className="s-banks"><span>ABA PayWay</span><span>KHQR</span><span>ABA Bank</span><span>ACLEDA Bank</span></div>
    </>
  );
}

/** "Talk to us": the Telegram QR to scan with a phone, plus Telegram, phone and email links. */
function ContactCard({ contact }: { contact: Plans['contact'] }) {
  const { t } = useLang();
  const tg = contact.telegram ? telegramUrl(contact.telegram) : null;
  const handle = contact.telegram && !/^https?:/.test(contact.telegram) ? `@${contact.telegram.replace(/^@/, '')}` : t('contact.telegram');
  return (
    <div className="s-contact-card">
      {contact.telegramQr && (
        <a className="qr" href={tg ?? undefined} target="_blank" rel="noreferrer" aria-label={t('contact.scan')}>
          <img src={contact.telegramQr} alt={`Telegram ${handle}`} loading="lazy" />
        </a>
      )}
      <div className="info">
        <h3>{t('contact.title')}</h3>
        <p>{t('contact.sub')}</p>
        {contact.telegramQr && <p className="faint small"><Icon name="scan" size={14} /> {t('contact.scan')}</p>}
        <div className="s-contact">
          {tg && <a href={tg} target="_blank" rel="noreferrer"><Icon name="sparkle" size={18} />{handle}</a>}
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}><Icon name="phone" size={18} />{contact.phone}</a>}
          {contact.email && <a href={`mailto:${contact.email}`}><Icon name="file" size={18} />{contact.email}</a>}
        </div>
      </div>
    </div>
  );
}

function Landing() {
  const { t, period } = useLang();
  const { data: plans } = usePlans();
  const months = plans?.trialMonths ?? 1;
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap">
          <div>
            <span className="s-kicker">{t('hero.kicker')}</span>
            <h1>{t('hero.title')}</h1>
            <p className="lead">{t('hero.sub')}</p>
            <div className="s-ctas">
              <AppLink className="btn primary" to="/signup">{t('hero.cta')} <Icon name="right" size={18} /></AppLink>
              <a className="btn" href="#pricing">{t('hero.cta2')}</a>
            </div>
            <div className="s-note">{t('hero.note', { months })}</div>
            <ul className="s-points">
              {(['hero.p1', 'hero.p2', 'hero.p3'] as const).map((k) => <li key={k}><Icon name="check" size={18} stroke={3} />{t(k)}</li>)}
            </ul>
          </div>
          <PhoneMock />
        </div>
      </section>

      <section className="s-section" id="features">
        <div className="s-wrap">
          <div className="s-title"><h2>{t('features.title')}</h2><p>{t('features.sub')}</p></div>
          <div className="s-features">
            {FEATURES.map(([icon, k]) => (
              <div className="s-feature" key={k}>
                <div className="ic"><Icon name={icon} size={22} /></div>
                <h3>{t(`${k}.t`)}</h3>
                <p>{t(`${k}.d`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section alt" id="how">
        <div className="s-wrap">
          <div className="s-title"><h2>{t('how.title')}</h2></div>
          <div className="s-steps">
            {([1, 2, 3] as const).map((n) => (
              <div className="s-step" key={n}><h3>{t(`how.${n}t`)}</h3><p>{t(`how.${n}d`)}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section" id="pricing">
        <div className="s-wrap">
          <div className="s-title"><h2>{t('pricing.title')}</h2><p>{t('pricing.sub', { period: period(months) })}</p></div>
          {plans ? <Pricing plans={plans} /> : <Loading />}
        </div>
      </section>

      <section className="s-section alt" id="faq">
        <div className="s-wrap">
          <div className="s-title"><h2>{t('faq.title')}</h2></div>
          <div className="s-faq">
            {([1, 2, 3, 4, 5, 6] as const).map((n) => (
              <details key={n} open={n === 1}>
                <summary>{t(`q${n}`)}</summary>
                <p>{t(`a${n}`, { grace: 7 })}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section" id="contact">
        <div className="s-wrap">
          <div className="s-cta">
            <h2>{t('cta.title')}</h2>
            <p>{t('cta.sub')}</p>
            <AppLink className="btn" to="/signup">{t('hero.cta')}</AppLink>
          </div>
          {plans && <ContactCard contact={plans.contact} />}
        </div>
      </section>
      <Footer plans={plans} />
    </>
  );
}

function Signup() {
  const demo = useDemo();
  useEffect(() => {
    if (demo) window.location.replace(`${demo.mainSiteUrl}/signup`);
  }, [demo]);
  const { t, period } = useLang();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: plans } = usePlans();
  const [f, setF] = useState({ companyName: '', companyCode: '', fullName: '', email: '', phone: '', password: '', tierId: params.get('plan') ?? '', acceptTerms: false, website: '' });
  const [codeEdited, setCodeEdited] = useState(false);
  const [codeState, setCodeState] = useState<'free' | 'taken' | null>(null);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (plans && !plans.tiers.some((x) => x.id === f.tierId)) set('tierId', plans.tiers[0]?.id ?? '');
  }, [plans]);

  // Suggest a code from the company name until the user types their own; check that it is free.
  useEffect(() => {
    const h = setTimeout(async () => {
      try {
        if (!codeEdited && f.companyName.trim().length >= 2) {
          const r = await api<{ code: string }>('/public/company-code', { query: { name: f.companyName } });
          setF((s) => ({ ...s, companyCode: r.code }));
          setCodeState('free');
        } else if (codeEdited && f.companyCode.length >= 2) {
          const r = await api<{ available: boolean }>('/public/company-code', { query: { code: f.companyCode } });
          setCodeState(r.available ? 'free' : 'taken');
        }
      } catch {
        setCodeState(null);
      }
    }, 450);
    return () => clearTimeout(h);
  }, [f.companyName, f.companyCode, codeEdited]);

  const tier = plans?.tiers.find((x) => x.id === f.tierId);
  const trialEnd = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + (plans?.trialMonths ?? 1));
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }, [plans?.trialMonths]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api<SessionResponse>('/public/signup', { body: { ...f, companyCode: f.companyCode.trim() || undefined, website: f.website || undefined } }));
    if (r) {
      startSession(r);
      navigate('/admin?welcome=1');
    }
  }

  const months = plans?.trialMonths ?? 1;
  return (
    <div className="s-signup">
      <div className="side">
        <h2>{t('signup.title')}</h2>
        <ul>
          <li><Icon name="check" stroke={3} />{t('signup.why1', { period: period(months) })}</li>
          <li><Icon name="check" stroke={3} />{t('signup.why2')}</li>
          <li><Icon name="check" stroke={3} />{t('signup.why3')}</li>
        </ul>
      </div>
      <div className="form">
        <form onSubmit={submit}>
          <div>
            <h1>{t('signup.title')}</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>{t('signup.sub', { months })}</p>
          </div>
          <Field label={t('signup.companyName')} htmlFor="su-cn">
            <input id="su-cn" className="input lg" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} required minLength={2} maxLength={120} autoComplete="organization" />
          </Field>
          <Field label={t('signup.companyCode')} htmlFor="su-cc" hint={
            codeState === 'taken' ? <span style={{ color: 'var(--bad)' }}>{t('signup.codeTaken')}</span> : codeState === 'free' && f.companyCode ? <span style={{ color: 'var(--good)' }}>✓ {t('signup.codeFree')} · {t('signup.codeHint')}</span> : t('signup.codeHint')
          }>
            <input id="su-cc" className="input lg mono" value={f.companyCode} onChange={(e) => { setCodeEdited(true); set('companyCode', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')); }} maxLength={40} autoCapitalize="none" />
          </Field>
          <div className="grid2">
            <Field label={t('signup.fullName')} htmlFor="su-n"><input id="su-n" className="input lg" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></Field>
            <Field label={t('signup.phone')} htmlFor="su-p"><input id="su-p" className="input lg" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} required placeholder="012 345 678" autoComplete="tel" /></Field>
          </div>
          <Field label={t('signup.email')} htmlFor="su-e"><input id="su-e" className="input lg" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required maxLength={160} autoComplete="email" /></Field>
          <Field label={t('signup.password')} htmlFor="su-pw" hint={t('signup.passwordHint')}><PasswordInput id="su-pw" value={f.password} onChange={(v) => set('password', v)} autoComplete="new-password" /></Field>
          <Field label={t('signup.staff')} htmlFor="su-t">
            <select id="su-t" className="select lg" value={f.tierId} onChange={(e) => set('tierId', e.target.value)} required>
              {plans?.tiers.map((x) => <option key={x.id} value={x.id}>{t('pricing.staff', { min: x.minStaff, max: x.maxStaff })} · {x.maxBranches == null ? t('pricing.branchesUnlimited') : x.maxBranches === 1 ? t('pricing.branch1') : t('pricing.branches', { n: x.maxBranches })} · {usd(x.monthlyPrice)} {t('pricing.perMonth')}</option>)}
            </select>
          </Field>
          {tier && <p className="faint small" style={{ margin: 0 }}>{t('signup.after', { date: trialEnd, price: usd(tier.monthlyPrice), min: tier.minStaff, max: tier.maxStaff })}</p>}
          <div className="s-hp" aria-hidden="true">
            <label>Website <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} /></label>
          </div>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={f.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} required style={{ marginTop: 4 }} />
            <span>{t('signup.terms')} <Link to="/terms" target="_blank">{t('signup.termsLink')}</Link></span>
          </label>
          <ErrorText error={error} />
          <button className="btn primary lg block" disabled={busy || codeState === 'taken'}>{busy ? t('signup.busy') : t('signup.submit')}</button>
          <p className="center small muted" style={{ margin: 0 }}>{t('signup.have')} <a href="/admin">{t('nav.signin')}</a></p>
        </form>
      </div>
    </div>
  );
}

function Terms() {
  const { t, lang } = useLang();
  const km = lang === 'km';
  const S = ({ h, children }: { h: string; children: ReactNode }) => <><h2>{h}</h2>{children}</>;
  return (
    <div className="s-terms">
      <h1>{t('terms.title')}</h1>
      {km ? (
        <>
          <S h="១. សេវាកម្ម"><p>MySoft Attendance ផ្តល់ប្រព័ន្ធចុះវត្តមាន ម៉ោងបន្ថែម និងប្រាក់ខែ តាមអនឡាញ។ អ្នកទទួលខុសត្រូវចំពោះព័ត៌មានដែលអ្នកបញ្ចូល និងការប្រើប្រាស់គណនីរបស់ក្រុមហ៊ុនអ្នក។</p></S>
          <S h="២. ការសាកល្បង និងការបង់ប្រាក់"><p>គណនីថ្មីទទួលបានការសាកល្បងឥតគិតថ្លៃ។ បន្ទាប់ពីការសាកល្បង តម្លៃគិតតាមចំនួនបុគ្គលិកសកម្ម ហើយត្រូវបង់ជាមុន ប្រចាំខែ ឬប្រចាំឆ្នាំ។ បើមិនបានបង់ គណនីនៅប្រើបាន ៧ ថ្ងៃទៀត បន្ទាប់មកអាចមើលបានតែប៉ុណ្ណោះ។ ប្រាក់ដែលបានបង់រួច មិនអាចដកវិញបានទេ លើកលែងតែមានកំហុសពីយើង។ សូមមើល <Link to="/refund-policy">គោលការណ៍លុបចោល និងសងប្រាក់វិញ</Link>។</p></S>
          <S h="៣. ទិន្នន័យ និងឯកជនភាព"><p>ទិន្នន័យរបស់ក្រុមហ៊ុនអ្នកជាកម្មសិទ្ធិរបស់អ្នក។ យើងប្រើវាតែដើម្បីផ្តល់សេវាកម្មប៉ុណ្ណោះ មិនលក់ ឬចែករំលែកដល់អ្នកដទៃទេ។ ទីតាំង GPS ត្រូវបានកត់ត្រាតែនៅពេលបុគ្គលិកស្កេនប៉ុណ្ណោះ។ អ្នកអាចទាញយកទិន្នន័យរបស់អ្នកបានគ្រប់ពេល ហើយស្នើសុំលុបគណនីបាន។</p></S>
          <S h="៤. សុវត្ថិភាព"><p>យើងប្រើ HTTPS អ៊ិនគ្រីបពាក្យសម្ងាត់ និងបម្រុងទុកទិន្នន័យរៀងរាល់យប់។ សូមរក្សាពាក្យសម្ងាត់របស់អ្នកជាការសម្ងាត់។</p></S>
          <S h="៥. ទំនាក់ទំនង"><p>សម្រាប់សំណួរ ឬការស្នើសុំ សូមទាក់ទងមក MySoft KH តាមលេខទូរស័ព្ទ ឬអ៊ីមែលដែលមាននៅលើគេហទំព័រ។</p></S>
        </>
      ) : (
        <>
          <S h="1. The service"><p>MySoft Attendance provides online attendance, overtime and payroll software. You are responsible for the information you enter and for how your company's accounts are used.</p></S>
          <S h="2. Trial and payment"><p>New accounts get a free trial. After the trial the price depends on the number of active staff and is paid in advance, monthly or yearly. If a payment is missed the account keeps working for 7 more days and then becomes read-only. Payments are not refunded except for our own errors; see the <Link to="/refund-policy">Cancellation &amp; Refund Policy</Link>.</p></S>
          <S h="3. Data and privacy"><p>Your company's data belongs to you. We use it only to provide the service and never sell or share it. GPS location is recorded only when an employee scans. You can export your data at any time and ask us to delete your account.</p></S>
          <S h="4. Security"><p>We use HTTPS, encrypt passwords and back up the data every night. Keep your password secret.</p></S>
          <S h="5. Contact"><p>For questions or requests, contact MySoft KH by the phone number or email shown on this website.</p></S>
        </>
      )}
      <p><Link to="/">← {t('brand')}</Link></p>
    </div>
  );
}

/** Cancellation & Refund Policy (the same text customers accept on the payment page), in the site's language. */
function RefundPolicyPage() {
  const { t, lang } = useLang();
  return (
    <div className="s-terms">
      <RefundPolicyText lang={lang} />
      <p><a href={REFUND_POLICY_DOCX} download>{t('refund.download')}</a> · <Link to="/terms">{t('footer.terms')}</Link></p>
      <p><Link to="/">← {t('brand')}</Link></p>
    </div>
  );
}

/** On the public demo: how to sign in, above the website. */
function DemoSiteBanner() {
  const demo = useDemo();
  const { t } = useLang();
  if (!demo) return null;
  return (
    <div className="s-demo">
      <div className="s-wrap">
        <span><b>{t('demo.title')}</b> {t('demo.text', { reset: String(demo.resetHour ?? 3) })}</span>
        <span className="s-demo-logins">
          <span>{t('demo.admin')}: <b className="mono">{demo.adminLogin}</b></span>
          <span>{t('demo.app')}: <b className="mono">{demo.companyCode}</b> / <b className="mono">{demo.employeeId}</b></span>
          <span>{t('demo.password')}: <b className="mono">{demo.password}</b></span>
        </span>
        <span className="row" style={{ gap: 8 }}>
          <a className="btn sm primary" href="/admin">{t('demo.openAdmin')}</a>
          <a className="btn sm" href="/app">{t('demo.openApp')}</a>
        </span>
      </div>
    </div>
  );
}

/** The public website: landing page with prices, sign-up with a free trial, terms. */
export default function Site() {
  const { lang } = useLang();
  useVisitCounter(lang);
  useEffect(() => {
    document.title = 'MySoft Attendance · QR attendance, overtime and payroll for Cambodia';
    return () => {
      document.title = 'MySoft · QR and Phones Attendance';
    };
  }, []);
  return (
    <div className="site" lang={lang}>
      <DemoSiteBanner />
      <Header />
      <Routes>
        <Route index element={<Landing />} />
        <Route path="signup" element={<Signup />} />
        <Route path="terms" element={<Terms />} />
        <Route path="refund-policy" element={<RefundPolicyPage />} />
        <Route path="pricing" element={<Navigate to="/#pricing" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
