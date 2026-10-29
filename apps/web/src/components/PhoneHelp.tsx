import { Fragment, ReactNode, useEffect, useState } from 'react';
import { detectEnv, PhoneEnv } from '../lib/platform';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

/**
 * Step-by-step help that matches the employee's phone: iPhone (Safari / Chrome / home-screen app), Android
 * (Chrome, Samsung Internet, Xiaomi, OPPO, vivo...) and Huawei (HarmonyOS / EMUI, Huawei Browser).
 */

const b = (s: string) => <b>{s}</b>;

/**
 * t() for a sentence with JSX pieces (bold menu names, links): tx('Tap {0} → {1}.', b('Share'), b('Add')).
 * The pieces are put where {0}, {1}... stand in the translated text, so the sentence stays whole for translators.
 */
export function tx(text: string, ...parts: ReactNode[]): ReactNode {
  return <>{t(text).split(/\{(\d+)\}/).map((s, i) => (i % 2 ? <Fragment key={i}>{parts[Number(s)]}</Fragment> : s))}</>;
}

export function locationSteps(env: PhoneEnv = detectEnv()): ReactNode[] {
  if (env.os === 'iOS') {
    const app = env.standalone || env.browser === 'Safari' ? 'Safari Websites' : env.browser;
    return [
      tx('Open the iPhone {0} app → {1} → {2} and turn it on.', b('Settings'), b('Privacy & Security'), b('Location Services')),
      tx('Scroll down, tap {0}, choose {1} and turn {2} on.', b(app), b('While Using the App'), b('Precise Location')),
      ...(env.browser === 'Safari' && !env.standalone
        ? [tx('In Safari tap {0} in the address bar → {1} → {2} → {3}.', b('aA'), b('Website Settings'), b('Location'), b('Allow'))]
        : []),
      tx('Come back, reload the page (or reopen the app) and tap {0} when asked.', b('Allow')),
    ];
  }
  const turnOn = tx('Swipe down from the top of the screen and turn {0} on.', b('Location'));
  if (env.browser === 'Samsung Internet') {
    return [
      turnOn,
      tx('Phone {0} → {1} → {2} → {3} → {4} → {5}.', b('Settings'), b('Apps'), b('Samsung Internet'), b('Permissions'), b('Location'), b('Allow only while using the app')),
      tx('In Samsung Internet tap {0} → {1} → {2} → {3} → {4} and allow this site.', b('☰'), b('Settings'), b('Sites and downloads'), b('Site permissions'), b('Location')),
      tx('Come back, reload the page and tap {0} when asked.', b('Allow')),
    ];
  }
  if (env.os === 'HarmonyOS' || /Huawei|Honor/.test(env.browser)) {
    return [
      turnOn,
      tx('Phone {0} → {1} → {2} → {3} → {4} → {5} → {6}.', b('Settings'), b('Apps'), b('Apps'), b(env.browser.includes('Honor') ? 'Browser' : 'Huawei Browser / Browser'), b('Permissions'), b('Location'), b('Allow only while in use')),
      tx('In the browser tap {0} or {1} → {2} → {3} → {4} → {5} and allow this site.', b('⋮'), b('☰'), b('Settings'), b('Privacy & security'), b('Site settings'), b('Location')),
      tx('Come back, reload the page and tap {0} when asked.', b('Allow')),
    ];
  }
  const browser = env.inApp ? 'Chrome' : env.browser;
  return [
    turnOn,
    tx('Tap the icon left of the web address → {0} (or {1}) → {2} → {3}.', b('Permissions'), b('Site settings'), b('Location'), b('Allow')),
    tx('If it is still blocked: phone {0} → {1} → {2} → {3} → {4} → {5}, with {6} on.', b('Settings'), b('Apps'), b(browser), b('Permissions'), b('Location'), b('Allow only while using the app'), b('Use precise location')),
    tx('Come back, reload the page and tap {0} when asked.', b('Allow')),
  ];
}

export function cameraSteps(env: PhoneEnv = detectEnv()): ReactNode[] {
  if (env.os === 'iOS') {
    const app = env.standalone || env.browser === 'Safari' ? 'Safari' : env.browser;
    return [
      tx('Open the iPhone {0} app → ({1} →) {2} → {3} → {4} or {5}.', b('Settings'), b('Apps'), b(app), b('Camera'), b('Ask'), b('Allow')),
      tx('Come back, reload the page and tap {0} when asked for the camera.', b('Allow')),
    ];
  }
  const app = env.os === 'HarmonyOS' && !env.inApp ? 'Browser' : env.inApp ? 'Chrome' : env.browser;
  return [
    tx('Tap the icon left of the web address → {0} → {1} → {2}.', b('Permissions'), b('Camera'), b('Allow')),
    tx('If it is still blocked: phone {0} → {1} → {2} → {3} → {4} → {5}.', b('Settings'), b('Apps'), b(app), b('Permissions'), b('Camera'), b('Allow only while using the app')),
    t("Or simply scan the poster with your phone's own camera or scan app: it opens the attendance link by itself."),
  ];
}

export function StepList({ steps }: { steps: ReactNode[] }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {steps.map((s, i) => <li key={i}>{s}</li>)}
    </ol>
  );
}

/** Shown when the app was opened inside Telegram, Facebook, LINE... where camera, GPS and storage are unreliable. */
export function InAppWarning({ env = detectEnv() }: { env?: PhoneEnv }) {
  const [copied, setCopied] = useState(false);
  if (!env.inApp) return null;
  const how = env.os === 'iOS'
    ? tx('Tap {0} or the {1} button → {2} (or {3}).', b('⋯'), b('Share'), b(`Open in ${env.recommended}`), b('Open in browser'))
    : tx('Tap {0} (top right) → {1} or {2}.', b('⋮'), b('Open in browser'), b(`Open in ${env.recommended}`));
  return (
    <div className="alert warn" role="alert">
      <Icon name="alert" size={17} />
      <div className="stack tight">
        <span>
          {tx('You opened this inside {0}. The camera, location and phone registration do not work reliably here.', <b>{env.inApp}</b>)}{' '}
          {tx('Open it in {0}:', <b>{env.recommended}</b>)}
        </span>
        <span>{how}</span>
        <button
          type="button"
          className="btn sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.origin + '/app');
              setCopied(true);
            } catch {
              prompt(t('Copy this link and open it in your browser:'), location.origin + '/app');
            }
          }}
        >
          {copied ? t('Link copied - paste it in your browser') : t('Copy the link')}
        </button>
      </div>
    </div>
  );
}

// The install prompt (Android Chrome, Samsung Internet, Edge...) fires once, early; main.tsx keeps it for later.
declare global {
  interface Window {
    __qraInstallPrompt?: any;
  }
}

/** "Install the app" card with the steps for this phone; hidden when already installed or on a computer. */
export function InstallCard({ env = detectEnv(), compact }: { env?: PhoneEnv; compact?: boolean }) {
  const [prompt, setPrompt] = useState<any>(window.__qraInstallPrompt ?? null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('qra.installDismissed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const on = () => setPrompt(window.__qraInstallPrompt ?? null);
    window.addEventListener('qra-install-ready', on);
    return () => window.removeEventListener('qra-install-ready', on);
  }, []);
  if (env.standalone || !env.mobile || env.inApp || (compact && dismissed)) return null;

  let steps: ReactNode[];
  if (env.os === 'iOS') {
    steps = env.browser === 'Safari'
      ? [tx('Tap the {0} button (square with an arrow).', b('Share')), tx('Tap {0} → {1}.', b('Add to Home Screen'), b('Add')), tx('Open the app from the new {0} icon from now on.', b('Attendance'))]
      : [tx('Open this page in {0} (the app can only be added to the home screen from Safari).', b('Safari')), tx('Tap {0} → {1} → {2}.', b('Share'), b('Add to Home Screen'), b('Add'))];
  } else if (env.browser === 'Samsung Internet') {
    steps = [tx('Tap {0} (bottom right) → {1} → {2}.', b('☰'), b('Add page to'), b('Home screen')), t('Open the app from the new icon from now on.')];
  } else if (env.os === 'HarmonyOS' || /Huawei|Honor/.test(env.browser)) {
    steps = [tx('Tap {0} or {1} → {2} (or {3}).', b('⋮'), b('☰'), b('Add to home screen'), b('Add to desktop')), t('Open the app from the new icon from now on.')];
  } else {
    steps = [tx('Tap {0} (top right) → {1} or {2}.', b('⋮'), b('Install app'), b('Add to Home screen')), t('Open the app from the new icon from now on.')];
  }

  return (
    <div className="card card-pad stack tight">
      <div className="row between">
        <strong className="row"><Icon name="download" size={16} /> {t('Install the app on this phone')}</strong>
        {compact && (
          <button className="btn ghost sm icon" aria-label={t('Hide')} onClick={() => {
            try { localStorage.setItem('qra.installDismissed', '1'); } catch { /* ignore */ }
            setDismissed(true);
          }}><Icon name="x" size={14} /></button>
        )}
      </div>
      {prompt && env.os !== 'iOS' ? (
        <button className="btn primary" onClick={async () => {
          prompt.prompt();
          await prompt.userChoice.catch(() => undefined);
          window.__qraInstallPrompt = undefined;
          setPrompt(null);
        }}>{t('Install app')}</button>
      ) : (
        <div className="small"><StepList steps={steps} /></div>
      )}
      <span className="faint small">{t('Always open attendance the same way (the icon). Each browser on a phone counts as a different phone.')}</span>
    </div>
  );
}
