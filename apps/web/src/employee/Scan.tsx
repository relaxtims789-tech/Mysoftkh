import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { deviceStatus, getDeviceKey, registerDevice, scanMessage, sign } from '../lib/device';
import { Fix, GeoError, getBestPosition, permissionState } from '../lib/geo';
import { extractToken, QrScanner } from '../lib/qr-scanner';
import { time12 } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Icon, IconName } from '../components/Icon';
import { Spinner } from '../components/ui';
import { cameraSteps, InAppWarning, locationSteps, StepList, tx } from '../components/PhoneHelp';
import { haptic, isMiniApp, openTelegramLocationSettings, telegramLocation, telegramScanQr } from '../lib/telegram';

/**
 * Employee scan flow: Scan QR -> GPS permission/location -> phone verification -> submit -> success / failed.
 * The server re-checks everything (QR, branch, geofence, employee, device signature, rules); this screen only
 * collects the inputs and explains the result.
 */

type Stage =
  | { name: 'camera' }
  | { name: 'gps-intro'; token: string }
  | { name: 'working'; token: string; step: number; accuracy?: number }
  | { name: 'gps-help'; token: string; reason: GeoError['code']; message: string }
  | { name: 'confirm-early'; token: string; fix: Fix | null; message: string }
  | { name: 'success'; result: any }
  | { name: 'duplicate'; message: string; detail?: string }
  | { name: 'failed'; code: string; message: string; details?: any; token?: string };

const FAIL_TITLES: Record<string, [string, IconName]> = {
  OUTSIDE_GEOFENCE: [t('Outside attendance area'), 'pin'],
  GPS_INACCURATE: [t('Weak GPS signal'), 'pin'],
  GPS_REQUIRED: [t('Location needed'), 'pin'],
  INVALID_QR: [t('Invalid QR code'), 'qr'],
  QR_DISABLED: [t('QR code disabled'), 'qr'],
  BRANCH_INACTIVE: [t('Branch closed'), 'building'],
  WRONG_BRANCH: [t('Wrong branch'), 'building'],
  DEVICE_PENDING: [t('Phone waiting for approval'), 'phone'],
  DEVICE_NOT_REGISTERED: [t('Phone not registered'), 'phone'],
  DEVICE_NOT_ALLOWED: [t('Phone not allowed'), 'phone'],
  DEVICE_REQUIRED: [t('Phone not registered'), 'phone'],
  BAD_DEVICE_SIGNATURE: [t('Phone verification failed'), 'shield'],
  BAD_CHALLENGE: [t('Please scan again'), 'refresh'],
  BUTTON_CHECKIN_DISABLED: [t('Please scan the QR code'), 'qr'],
  ALREADY_CHECKED_IN: [t('Already checked in'), 'check'],
  ALREADY_CHECKED_OUT: [t('Already checked out'), 'check'],
  ALREADY_RECORDED: [t('Already recorded'), 'check'],
  EMPLOYEE_INACTIVE: [t('Account inactive'), 'user'],
  NETWORK: [t('No connection'), 'alert'],
  RATE_LIMITED: [t('Too many attempts'), 'clock'],
};

const HELP: Record<string, string> = {
  OUTSIDE_GEOFENCE: t('Move inside the office and scan again. If you are inside, wait a few seconds for GPS to settle.'),
  GPS_INACCURATE: t('Step near a window or outside, make sure Location is set to "Precise", and try again.'),
  DEVICE_NOT_REGISTERED: t('Use the phone you registered, or ask HR to reset your device.'),
  DEVICE_PENDING: t('HR has been notified. You can scan once this phone is approved.'),
  DEVICE_NOT_ALLOWED: t('Use your registered phone, or ask HR to reset your device.'),
  QR_DISABLED: t('This poster is no longer valid. Scan the current QR code at the entrance.'),
  INVALID_QR: t('Make sure you scan the attendance QR code posted at your office.'),
};

function Result({ tone, icon, title, children, actions }: { tone: string; icon: IconName; title: string; children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="result">
      <div className={`result-icon ${tone}`}><Icon name={icon} size={48} stroke={2.4} /></div>
      <h1>{title}</h1>
      {children}
      <div className="actions">{actions}</div>
    </div>
  );
}

/** Stands in for the QR token when the employee uses the Check-in / Check-out button (signed the same way). */
const BUTTON = 'BUTTON';

/**
 * punchType set: Check-in / Check-out button without a QR (when the company allows it). The flow is the same as a scan
 * (location, phone, record) but the server picks the branch from the GPS position.
 */
export function ScanFlow({ initialToken, type, punchType }: { initialToken?: string; type?: string; punchType?: string }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(() =>
    punchType ? { name: 'working', token: BUTTON, step: 0 } : initialToken ? { name: 'working', token: initialToken, step: 0 } : { name: 'camera' });
  const effectiveType = punchType ?? type;
  const started = useRef(false);

  const fail = (e: unknown, token?: string) => {
    const err = e as ApiError;
    if (err.code === 'DUPLICATE_SCAN') {
      setStage({ name: 'duplicate', message: tServer(err.message), detail: err.details?.time ? t('{type} at {time}', { type: tServer(err.details.typeLabel), time: time12(err.details.time) }) : undefined });
    } else {
      setStage({ name: 'failed', code: err.code || 'ERROR', message: err.message ? tServer(err.message) : t('Something went wrong.'), details: err.details, token });
    }
  };

  /** Device: make sure this phone is registered (first phone is approved automatically if the company allows). */
  const ensureDevice = async (): Promise<boolean> => {
    try {
      const st = await deviceStatus();
      const status = st.device?.status;
      if (status === 'active') return true;
      if (!status || status === 'revoked') {
        const r = await registerDevice();
        if (r.device.status === 'active') return true;
        if (st.bindingRequired) throw new ApiError(403, r.device.status === 'pending' ? 'DEVICE_PENDING' : 'DEVICE_NOT_ALLOWED', r.message);
        return false;
      }
      // pending or rejected
      if (st.bindingRequired) throw new ApiError(403, status === 'pending' ? 'DEVICE_PENDING' : 'DEVICE_NOT_ALLOWED', st.message);
      return false;
    } catch (e) {
      if ((e as ApiError).code === 'NO_CRYPTO') return false; // the server decides whether a device is required
      throw e;
    }
  };

  const submit = useCallback(async (token: string, fix: Fix | null, useDevice: boolean, confirmEarly = false) => {
    setStage({ name: 'working', token, step: 2 });
    const body: any = { ...(punchType ? {} : { qrToken: token }), ...(effectiveType ? { type: effectiveType } : {}), ...(confirmEarly ? { confirmEarly: true } : {}) };
    if (fix) Object.assign(body, { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy });
    try {
      if (useDevice) {
        const k = await getDeviceKey();
        const { challenge } = await api<{ challenge: string }>('/attendance/challenge');
        const signature = await sign(scanMessage({ challenge, qrToken: token, type: body.type, latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy }));
        body.device = { id: k.id, challenge, signature };
      }
      const result = await api(punchType ? '/attendance/punch' : '/attendance/scan', { body });
      if (navigator.vibrate) navigator.vibrate(80);
      haptic('success');
      setStage({ name: 'success', result });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'CONFIRM_EARLY_CHECKOUT') setStage({ name: 'confirm-early', token, fix, message: tServer(err.message) });
      else fail(e, token);
    }
  }, [effectiveType, punchType]);

  const run = useCallback(async (token: string, skipIntro = false) => {
    // Telegram asks for location itself.
    if (!skipIntro && !isMiniApp()) {
      let explained = false;
      try { explained = localStorage.getItem('qra.gpsExplained') === '1'; } catch { /* ignore */ }
      if (!explained && (await permissionState()) === 'prompt') {
        setStage({ name: 'gps-intro', token });
        return;
      }
    }
    setStage({ name: 'working', token, step: 0 });
    try {
      const today = await api<{ rules: { requireGps: boolean } }>('/attendance/today');
      const devicePromise = ensureDevice();
      let fix: Fix | null = null;
      try {
        // Inside Telegram (8.0+) its location service is used; elsewhere the browser's.
        fix = (isMiniApp() ? await telegramLocation() : undefined) ?? await getBestPosition({
          maxWait: today.rules.requireGps ? 10000 : 4000,
          onProgress: (f) => setStage((s) => (s.name === 'working' ? { ...s, accuracy: f.accuracy } : s)),
        });
      } catch (e) {
        if (today.rules.requireGps) {
          const g = e as GeoError;
          setStage({ name: 'gps-help', token, reason: g.code, message: g.message });
          devicePromise.catch(() => undefined);
          return;
        }
      }
      setStage({ name: 'working', token, step: 1, accuracy: fix?.accuracy });
      const useDevice = await devicePromise;
      await submit(token, fix, useDevice);
    } catch (e) {
      fail(e, token);
    }
  }, [submit]);

  useEffect(() => {
    if (punchType && !started.current) {
      started.current = true;
      run(BUTTON);
      return;
    }
    if (initialToken && !started.current) {
      started.current = true;
      const token = extractToken(initialToken);
      if (token) run(token);
      else setStage({ name: 'failed', code: 'INVALID_QR', message: t('This is not an attendance QR code.') });
    }
  }, [initialToken, punchType, run]);

  const done = () => navigate('/app', { replace: true });

  switch (stage.name) {
    case 'camera':
      return isMiniApp() ? <TelegramScanStage onToken={(tok) => run(tok)} onClose={done} /> : <CameraStage onToken={(tok) => run(tok)} onClose={done} />;

    case 'gps-intro':
      return (
        <Result tone="info" icon="pin" title={t('Allow location')} actions={
          <>
            <button className="btn primary lg block" onClick={() => { try { localStorage.setItem('qra.gpsExplained', '1'); } catch { /* ignore */ } run(stage.token, true); }}>{t('Continue')}</button>
            <button className="btn ghost block" onClick={done}>{t('Cancel')}</button>
          </>
        }>
          <p className="muted">{tx('Your company records attendance only inside the office area. Your phone will ask for your location. Choose {0} (and {1} on iPhone).', <b>Allow</b>, <b>Precise</b>)}</p>
          <p className="faint small">{t('Your location is checked only when you scan, never in the background.')}</p>
        </Result>
      );

    case 'working': {
      const steps = [t('Getting your location'), t('Verifying this phone'), t('Recording attendance')];
      return (
        <div className="result">
          <Spinner large />
          <h1>{steps[stage.step]}…</h1>
          <div className="steps card card-pad">
            {steps.map((label, i) => (
              <div key={label} className={`step${i < stage.step ? ' done' : i === stage.step ? ' now' : ''}`}>
                <span className="ic">{i < stage.step ? <Icon name="check" size={14} stroke={3} /> : i + 1}</span>
                {label}
                {i === 0 && stage.accuracy !== undefined && <span className="faint small">±{Math.round(stage.accuracy)} m</span>}
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'gps-help':
      return (
        <Result tone="warn" icon="pin" title={stage.reason === 'denied' ? t('Location is blocked') : t('No location')} actions={
          <>
            {isMiniApp() && stage.reason === 'denied' && <button className="btn primary lg block" onClick={() => openTelegramLocationSettings()}>{t('Allow location in Telegram')}</button>}
            <button className={`btn ${isMiniApp() && stage.reason === 'denied' ? '' : 'primary'} lg block`} onClick={() => run(stage.token, true)}>{t('Try again')}</button>
            <button className="btn ghost block" onClick={() => navigate('/app/check')}>{t('Check my phone')}</button>
            <button className="btn ghost block" onClick={done}>{t('Cancel')}</button>
          </>
        }>
          <p className="muted">{stage.message}</p>
          <InAppWarning />
          {isMiniApp() ? (
            stage.reason === 'denied' && <p className="muted small">{tx('Tap {0}, turn on location for this app, then {1}. Also make sure Telegram itself may use your location in the phone’s settings.', <b>{t('Allow location in Telegram')}</b>, <b>{t('Try again')}</b>)}</p>
          ) : (stage.reason === 'denied' || stage.reason === 'unavailable') && (
            <div className="card card-pad facts small"><StepList steps={locationSteps()} /></div>
          )}
        </Result>
      );

    case 'confirm-early':
      return (
        <Result tone="warn" icon="clock" title={t('Leave early?')} actions={
          <>
            <button className="btn primary lg block" onClick={async () => submit(stage.token, stage.fix, await ensureDevice().catch(() => false), true)}>{t('Yes, check out now')}</button>
            <button className="btn ghost block" onClick={done}>{t('Cancel')}</button>
          </>
        }>
          <p className="muted">{stage.message} {t('It will be recorded as early leave.')}</p>
        </Result>
      );

    case 'success': {
      const r = stage.result;
      const tone = r.status === 'late' || r.status === 'early_leave' ? 'warn' : 'good';
      const statusText = r.status === 'late' ? t('LATE · {n} min', { n: r.lateMinutes }) : r.status === 'early_leave' ? t('EARLY LEAVE · {n} min', { n: r.earlyMinutes }) : r.status === 'overtime' ? t('OVERTIME · {n} min', { n: r.overtimeMinutes }) : tServer(r.statusLabel);
      return (
        <Result tone="good" icon="check" title={t('{type} recorded', { type: tServer(r.typeLabel) })} actions={<button className="btn primary lg block" onClick={done}>{t('Done')}</button>}>
          <div className="big-time">{time12(r.time)}</div>
          <div className={`status-big ${tone}`}>{statusText}</div>
          <div className="card facts">
            <div className="kv card-pad" style={{ gridTemplateColumns: '110px 1fr' }}>
              <dt>{t('Location')}</dt><dd>{r.branchName}</dd>
              {r.distance !== null && (<><dt>{t('Distance')}</dt><dd>{t('{n} m from the office point', { n: r.distance })}</dd></>)}
              <dt>{t('Date')}</dt><dd>{r.date}</dd>
            </div>
          </div>
        </Result>
      );
    }

    case 'duplicate':
      return (
        <Result tone="info" icon="check" title={stage.message} actions={<button className="btn primary lg block" onClick={done}>{t('OK')}</button>}>
          {stage.detail && <p className="muted">{t('{detail}. No need to scan again.', { detail: stage.detail })}</p>}
        </Result>
      );

    case 'failed': {
      const [title, icon] = FAIL_TITLES[stage.code] ?? [t('Attendance not recorded'), 'x'];
      const retry = stage.token && !['DEVICE_PENDING', 'DEVICE_NOT_ALLOWED', 'EMPLOYEE_INACTIVE', 'QR_DISABLED', 'INVALID_QR', 'ALREADY_CHECKED_IN', 'WRONG_BRANCH'].includes(stage.code);
      const soft = stage.code.startsWith('ALREADY');
      return (
        <Result tone={soft ? 'info' : 'bad'} icon={soft ? icon : 'x'} title={title} actions={
          <>
            {retry && <button className="btn primary lg block" onClick={() => run(stage.token!, true)}>{t('Try again')}</button>}
            {!retry && !soft && (punchType
              ? <button className="btn primary lg block" onClick={() => navigate('/app/scan', { replace: true })}>{t('Scan the QR instead')}</button>
              : <button className="btn primary lg block" onClick={() => setStage({ name: 'camera' })}>{t('Scan another QR')}</button>)}
            {!soft && <button className="btn ghost block" onClick={() => navigate('/app/check')}>{t('Check my phone')}</button>}
            <button className="btn ghost block" onClick={done}>{t('Back to home')}</button>
          </>
        }>
          <p style={{ fontWeight: 600 }}>{stage.message}</p>
          {stage.details?.distance !== undefined && (
            <p className="muted">{tx('You are about {0} from {1}; the allowed area is {2} m.', <b>{t('{n} m', { n: stage.details.distance })}</b>, stage.details.branch ? <b>{stage.details.branch}</b> : t('the office'), stage.details.radius)}</p>
          )}
          {HELP[stage.code] && <p className="muted small">{HELP[stage.code]}</p>}
          {!soft && <p className="faint small">{t('Nothing was recorded. This attempt was logged for your HR team.')}</p>}
        </Result>
      );
    }
  }
}

function CameraStage({ onToken, onClose }: { onToken: (token: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    if (!video.current) return;
    let lastWrong = 0;
    const scanner = new QrScanner(video.current, (text) => {
      const token = extractToken(text);
      if (token) {
        scanner.stop();
        if (navigator.vibrate) navigator.vibrate(40);
        onToken(token);
        return true;
      }
      if (Date.now() - lastWrong > 1500) {
        lastWrong = Date.now();
        setWrong(true);
        setTimeout(() => setWrong(false), 2500);
      }
      return false; // not ours: keep scanning
    });
    scanner.start().catch((e: Error) => {
      setError(e.name === 'NotAllowedError'
        ? t("Camera access is blocked. Allow the camera for this site in your browser settings, or scan the QR with your phone's camera app.")
        : e.name === 'NotFoundError' ? t('No camera found on this device.') : e.message || t('Could not open the camera.'));
    });
    return () => scanner.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scan-screen">
      <video ref={video} playsInline muted />
      <div className="scan-top">
        <button className="btn icon" onClick={onClose} aria-label={t('Close')}><Icon name="x" /></button>
        <strong style={{ fontSize: 17 }}>{t('Scan the office QR')}</strong>
      </div>
      {error ? (
        <div className="result" style={{ color: '#fff', minHeight: 0, flex: 1, overflowY: 'auto' }}>
          <div className="result-icon bad"><Icon name="alert" size={40} /></div>
          <p>{error}</p>
          <div className="card card-pad facts small" style={{ color: 'var(--text)' }}><StepList steps={cameraSteps()} /></div>
          <button className="btn lg" onClick={onClose}>{t('Back')}</button>
        </div>
      ) : (
        <>
          <div className="scan-frame" />
          <div className="scan-hint">
            {wrong ? <b>{t('This is not an attendance QR code.')}</b> : tx('Point your camera at the {0} poster at the entrance.', <b>SCAN TO ATTEND</b>)}
          </div>
        </>
      )}
    </div>
  );
}


/** Inside Telegram: Telegram's own QR scanner (faster, no camera permission prompt). Falls back to the camera. */
function TelegramScanStage({ onToken, onClose }: { onToken: (token: string) => void; onClose: () => void }) {
  const [state, setState] = useState<'open' | 'closed' | 'unsupported'>('open');
  const open = useCallback(async () => {
    setState('open');
    const text = await telegramScanQr(t('Scan the attendance QR at the entrance'), (data) => !!extractToken(data));
    if (text === undefined) setState('unsupported');
    else if (text === null) setState('closed');
    else onToken(extractToken(text)!);
  }, [onToken]);
  useEffect(() => {
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (state === 'unsupported') return <CameraStage onToken={onToken} onClose={onClose} />;
  return (
    <Result tone="info" icon="qr" title={t('Scan the office QR')} actions={
      <>
        <button className="btn primary lg block" onClick={open}><Icon name="scan" /> {t('Open the scanner')}</button>
        <button className="btn ghost block" onClick={onClose}>{t('Back to home')}</button>
      </>
    }>
      <p className="muted">{tx('Point the scanner at the {0} poster at the entrance.', <b>SCAN TO ATTEND</b>)}</p>
    </Result>
  );
}
