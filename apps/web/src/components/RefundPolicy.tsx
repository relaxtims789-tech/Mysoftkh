import { useState } from 'react';
import { REFUND_POLICY as P, REFUND_POLICY_DOCX, REFUND_POLICY_EFFECTIVE, REFUND_POLICY_VERSION } from '../lib/refund-policy';
import { lang as appLang, t } from '../lib/i18n';
import { Icon } from './Icon';

export type PolicyLang = 'en' | 'km';

/** The full Cancellation & Refund Policy in one language (website page and the payment page's scroll box). */
export function RefundPolicyText({ lang, heading = true }: { lang: PolicyLang; heading?: boolean }) {
  return (
    <div className="policy-text" lang={lang}>
      {heading && <h1>{P.title[lang]}</h1>}
      <p className="policy-meta">{P.provider[lang]}<br />{P.versionLabel[lang]} {REFUND_POLICY_VERSION} · {P.effectiveLabel[lang]} {REFUND_POLICY_EFFECTIVE[lang]}</p>
      <p>{P.intro[lang]}</p>
      <div className="policy-summary">
        <b>{P.summaryTitle[lang]}</b>
        <ul>{P.summary.map((s, i) => <li key={i}>{s[lang]}</li>)}</ul>
      </div>
      {P.sections.map((s, i) => (
        <section key={i}>
          <h2>{s.title[lang]}</h2>
          {s.text?.map((t, j) => <p key={j}>{t[lang]}</p>)}
          {s.items && <ul>{s.items.map((t, j) => <li key={j}>{t[lang]}</li>)}</ul>}
          {s.lettered && <ol type="a">{s.lettered.map((t, j) => <li key={j}>{t[lang]}</li>)}</ol>}
          {s.after?.map((t, j) => <p key={j}>{t[lang]}</p>)}
        </section>
      ))}
    </div>
  );
}

export function PolicyLangSwitch({ lang, onChange }: { lang: PolicyLang; onChange: (l: PolicyLang) => void }) {
  return (
    <div className="policy-lang" role="group" aria-label={t('Language')}>
      <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => onChange('en')}>English</button>
      <button type="button" className={lang === 'km' ? 'on' : ''} onClick={() => onChange('km')} lang="km">ខ្មែរ</button>
    </div>
  );
}

/**
 * Payment page: the policy in a scroll box (English / Khmer), a Word download, and the "I have read and agree" box the
 * customer must tick before any payment. The ticked version is sent with the payment and saved on the invoice.
 */
export function RefundPolicyAccept({ checked, onChange, id = 'refund-policy' }: { checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  const [lang, setLang] = useState<PolicyLang>(appLang);
  return (
    <div className={`policy-accept${checked ? ' ok' : ''}`} id={id}>
      <div className="policy-accept-head">
        <b><Icon name="file" size={16} /> {P.title[lang]}</b>
        <span className="row" style={{ gap: 10 }}>
          <PolicyLangSwitch lang={lang} onChange={setLang} />
          <a className="small" href={REFUND_POLICY_DOCX} download>{t('Word (.docx)')}</a>
          <a className="small" href="/refund-policy" target="_blank" rel="noreferrer">{t('Open page')}</a>
        </span>
      </div>
      <div className="policy-scroll" tabIndex={0}>
        <RefundPolicyText lang={lang} heading={false} />
      </div>
      <label className="policy-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span lang={lang}>{P.acknowledge[lang]}</span>
      </label>
    </div>
  );
}

export { REFUND_POLICY_VERSION };
