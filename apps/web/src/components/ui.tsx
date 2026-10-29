import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { DAY_STATUS, PUNCH_STATUS } from '../lib/format';
import { t, tServer } from '../lib/i18n';
import { Icon, IconName } from './Icon';

export function Spinner({ large }: { large?: boolean }) {
  return <span className={`spinner${large ? ' lg' : ''}`} role="status" aria-label={t('Loading')} />;
}

export function Loading() {
  return (
    <div className="loading-block">
      <Spinner large />
    </div>
  );
}

export function Empty({ icon = 'list', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      <div>{children}</div>
    </div>
  );
}

export function Badge({ tone = 'muted', children, dot }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function DayBadge({ status }: { status: string }) {
  const s = DAY_STATUS[status] ?? { label: status, tone: 'muted' };
  if (!s.label) return null;
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function PunchBadge({ status }: { status: string }) {
  const s = PUNCH_STATUS[status] ?? { label: status, tone: 'muted' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const icon: IconName = tone === 'good' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return (
    <div className={`alert ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={icon} size={17} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const details: string[] = e.details?.errors?.map((x: any) => (typeof x === 'string' ? tServer(x) : t('Row {row}: {message}', { row: x.row, message: tServer(x.message) }))) ?? [];
  return (
    <Alert tone="bad">
      {tServer(e.message || String(error))}
      {details.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {details.slice(0, 8).map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </Alert>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch" style={{ alignItems: 'flex-start' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" style={{ marginTop: 1 }} />
      <span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hint && <span className="faint small" style={{ display: 'block' }}>{hint}</span>}
      </span>
    </label>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmOpts {
  title: string;
  message: ReactNode;
  confirm?: string;
  danger?: boolean;
  input?: { label: string; placeholder?: string; required?: boolean };
}

const ConfirmContext = createContext<(o: ConfirmOpts) => Promise<string | false>>(async () => false);
const ToastContext = createContext<(msg: string, tone?: 'good' | 'bad' | 'info') => void>(() => undefined);

/** App-wide confirm dialog and toasts. confirm() resolves to the typed text (or '' ) when confirmed, false when cancelled. */
export function UiProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirm] = useState<(ConfirmOpts & { resolve: (v: string | false) => void }) | null>(null);
  const [text, setText] = useState('');
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: string }[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<string | false>((resolve) => {
    setText('');
    setConfirm({ ...o, resolve });
  }), []);
  const toast = useCallback((msg: string, tone: 'good' | 'bad' | 'info' = 'good') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3500);
  }, []);

  const close = (v: string | false) => {
    confirmState?.resolve(v);
    setConfirm(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      <ToastContext.Provider value={toast}>
        {children}
        {confirmState && (
          <Modal
            title={confirmState.title}
            onClose={() => close(false)}
            footer={
              <>
                <button className="btn" onClick={() => close(false)}>{t('Cancel')}</button>
                <button
                  className={`btn ${confirmState.danger ? 'danger solid' : 'primary'}`}
                  disabled={!!confirmState.input?.required && !text.trim()}
                  onClick={() => close(text)}
                  autoFocus={!confirmState.input}
                >
                  {confirmState.confirm ?? t('Confirm')}
                </button>
              </>
            }
          >
            <div className="stack">
              <div className="muted">{confirmState.message}</div>
              {confirmState.input && (
                <Field label={confirmState.input.label}>
                  <input className="input" autoFocus value={text} placeholder={confirmState.input.placeholder} onChange={(e) => setText(e.target.value)} />
                </Field>
              )}
            </div>
          </Modal>
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone}`}>
              <Icon name={t.tone === 'bad' ? 'alert' : 'check'} size={16} />
              {t.msg}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
export const useToast = () => useContext(ToastContext);

/** Loads data from the API; reload() re-runs it. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/** Runs an async action with busy/error state and optional success toast. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, error, run, setError };
}

export function Avatar({ name, photo, large }: { name: string; photo?: string | null; large?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return <span className={`avatar${large ? ' lg' : ''}`}>{photo ? <img src={photo} alt="" /> : initials}</span>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="faint small" style={{ padding: '10px 12px' }}>{total} total</div>;
  return (
    <div className="row between" style={{ padding: '10px 12px' }}>
      <span className="faint small">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="row">
        <button className="btn sm icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('Previous page')}><Icon name="left" size={16} /></button>
        <span className="small">{page} / {pages}</span>
        <button className="btn sm icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('Next page')}><Icon name="right" size={16} /></button>
      </div>
    </div>
  );
}
