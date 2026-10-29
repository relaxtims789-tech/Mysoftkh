import { ReactNode, useEffect, useState } from 'react';
import { deviceKeyMode, deviceStatus, DeviceStatus, getDeviceKey, registerDevice } from '../lib/device';
import { GeoError, getBestPosition } from '../lib/geo';
import { describeDevice, detectEnv } from '../lib/platform';
import { t, tServer } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { cameraSteps, InAppWarning, InstallCard, locationSteps, StepList, tx } from '../components/PhoneHelp';
import { Spinner } from '../components/ui';
import { MobileTop } from './EmployeeApp';

type State = 'idle' | 'running' | 'ok' | 'warn' | 'fail';

function Row({ state, title, detail, children, action }: { state: State; title: string; detail?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const icon = state === 'ok' ? <span style={{ color: 'var(--good)' }}><Icon name="check" size={20} stroke={2.6} /></span>
    : state === 'fail' ? <span style={{ color: 'var(--bad)' }}><Icon name="x" size={20} stroke={2.6} /></span>
    : state === 'warn' ? <span style={{ color: 'var(--warn)' }}><Icon name="alert" size={20} /></span>
    : state === 'running' ? <Spinner />
    : <span className="faint"><Icon name="info" size={20} /></span>;
  return (
    <div className="day-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ width: 24, paddingTop: 1 }}>{icon}</div>
      <div className="grow stack tight">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <strong>{title}</strong>
          {action}
        </div>
        {detail && <div className="small muted">{detail}</div>}
        {children && <div className="small">{children}</div>}
      </div>
    </div>
  );
}

/**
 * One screen that tests everything attendance needs on this phone, with fixes for the phone's own OS and browser.
 * HR can ask an employee for a screenshot of it.
 */
export function PhoneCheckScreen() {
  const env = detectEnv();
  const [phone, setPhone] = useState<{ name: string; platform: string } | null>(null);
  const [key, setKey] = useState<{ state: State; text: string }>({ state: 'running', text: '' });
  const [reg, setReg] = useState<{ state: State; status?: DeviceStatus; text: string }>({ state: 'running', text: '' });
  const [loc, setLoc] = useState<{ state: State; text: string }>({ state: 'idle', text: t('Not tested yet.') });
  const [cam, setCam] = useState<{ state: State; text: string }>({ state: 'idle', text: t('Not tested yet.') });

  const checkKeyAndRegistration = async () => {
    try {
      await getDeviceKey();
      const mode = deviceKeyMode();
      setKey(mode === 'secure'
        ? { state: 'ok', text: t('Saved securely on this phone.') }
        : mode === 'saved'
          ? { state: 'ok', text: t('Saved on this phone (this browser cannot lock the key, which is fine).') }
          : { state: 'fail', text: t('Could not be saved - is private / incognito browsing on? Turn it off, or use a normal tab.') });
    } catch (e) {
      setKey({ state: 'fail', text: (e as Error).message || t('This browser cannot create a phone key.') });
    }
    try {
      const s = await deviceStatus();
      const st = s.device?.status;
      setReg({
        status: s,
        state: st === 'active' ? 'ok' : st === 'pending' ? 'warn' : s.bindingRequired ? 'fail' : 'warn',
        text: st === 'active' ? t('This phone is your registered attendance phone.') : tServer(s.message),
      });
    } catch (e) {
      setReg({ state: 'fail', text: tServer((e as Error).message) });
    }
  };

  const testLocation = async () => {
    setLoc({ state: 'running', text: t('Getting your location...') });
    try {
      const f = await getBestPosition({ maxWait: 12000, onProgress: (p) => setLoc({ state: 'running', text: t('Accuracy ±{n} m...', { n: Math.round(p.accuracy) }) }) });
      setLoc(f.accuracy <= 100
        ? { state: 'ok', text: t('Works. Accuracy ±{n} m.', { n: Math.round(f.accuracy) }) }
        : { state: 'warn', text: t('Works, but weak (±{n} m). Turn on precise location and go near a window.', { n: Math.round(f.accuracy) }) });
    } catch (e) {
      setLoc({ state: 'fail', text: e instanceof GeoError ? e.message : t('Location is not available.') });
    }
  };

  const testCamera = async () => {
    setCam({ state: 'running', text: t('Opening the camera...') });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('This browser cannot use the camera.'));
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      s.getTracks().forEach((tr) => tr.stop());
      setCam({ state: 'ok', text: t('Works.') });
    } catch (e) {
      const name = (e as Error).name;
      setCam({ state: 'fail', text: name === 'NotAllowedError' ? t('Camera access is blocked for this app.') : name === 'NotFoundError' ? t('No camera found.') : (e as Error).message || t('The camera could not be opened.') });
    }
  };

  useEffect(() => {
    describeDevice().then(setPhone);
    checkKeyAndRegistration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = [key.state, reg.state, loc.state, cam.state];
  const ready = all.every((s) => s === 'ok') && window.isSecureContext && !env.inApp;

  return (
    <>
      <MobileTop title={t('Check my phone')} />
      <div className="m-page">
        <InAppWarning env={env} />
        {ready && <div className="alert good"><Icon name="check" size={17} /><div><b>{t('This phone is ready for attendance.')}</b></div></div>}
        <div className="card">
          <Row
            state={env.supported ? 'ok' : 'warn'}
            title={phone?.name ?? t('This phone')}
            detail={`${phone?.platform ?? env.os}${env.standalone ? ` · ${t('opened from the home-screen icon')}` : ''}`}
          >
            {!env.supported && tx('For the best results use {0} on this phone.', <b>{env.recommended}</b>)}
          </Row>
          <Row state={window.isSecureContext ? 'ok' : 'fail'} title={t('Secure connection')} detail={window.isSecureContext ? t('https - camera and location are allowed.') : t('Not https: the phone blocks the camera and location. Open the https link.')} />
          <Row state={key.state} title={t('Phone key')} detail={key.text} />
          <Row
            state={reg.state}
            title={t('Registered phone')}
            detail={reg.text}
            action={!reg.status?.device && reg.state !== 'running' ? (
              <button className="btn sm primary" onClick={async () => {
                setReg({ state: 'running', text: t('Registering...') });
                await registerDevice().catch(() => undefined);
                checkKeyAndRegistration();
              }}>{t('Register')}</button>
            ) : undefined}
          />
          <Row state={loc.state} title={t('Location (GPS)')} detail={loc.text} action={<button className="btn sm" onClick={testLocation} disabled={loc.state === 'running'}>{t('Test')}</button>}>
            {loc.state === 'fail' && <StepList steps={locationSteps(env)} />}
          </Row>
          <Row state={cam.state} title={t('Camera')} detail={cam.text} action={<button className="btn sm" onClick={testCamera} disabled={cam.state === 'running'}>{t('Test')}</button>}>
            {cam.state === 'fail' && <StepList steps={cameraSteps(env)} />}
          </Row>
          <Row
            state={env.standalone ? 'ok' : 'idle'}
            title={t('Installed as an app')}
            detail={env.standalone ? t('Yes - opened from the home-screen icon.') : t('Not yet (optional, but recommended).')}
          />
        </div>
        {!env.standalone && <InstallCard env={env} />}
        <button className="btn primary lg block" onClick={() => { testLocation(); testCamera(); }}>{t('Test location and camera')}</button>
        <p className="faint small center">{t('If something stays red, take a screenshot of this page and send it to HR.')}</p>
      </div>
    </>
  );
}
