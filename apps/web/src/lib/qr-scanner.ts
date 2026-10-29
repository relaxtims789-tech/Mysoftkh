import { t } from './i18n';

type JsQr = typeof import('jsqr').default;

/** Pulls the branch token out of a scanned text: "https://host/scan/<token>" or the bare token. */
export function extractToken(text: string): string | null {
  const s = (text || '').trim();
  if (/^[A-Za-z0-9_-]{32,64}$/.test(s)) return s;
  const m = s.match(/\/scan\/([A-Za-z0-9_-]{32,64})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * Reads QR codes from the phone's back camera. Uses the native BarcodeDetector when available (Android Chrome),
 * otherwise jsQR on canvas frames (iOS Safari). onResult returns true to stop, false to keep scanning.
 */
export class QrScanner {
  private stream: MediaStream | null = null;
  private raf = 0;
  private stopped = false;
  private canvas = document.createElement('canvas');
  private detector: Detector | null = null;
  private jsQR: JsQr | null = null;

  constructor(private readonly video: HTMLVideoElement, private readonly onResult: (text: string) => boolean) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('This browser cannot use the camera. Use your phone camera app to scan the QR instead.'));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      // Some phones reject the size hints; any back (or front) camera is better than none.
      if ((e as Error).name !== 'OverconstrainedError' && (e as Error).name !== 'NotReadableError') throw e;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
    }
    if (this.stopped) {
      // stopped while the permission prompt was open
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;
    await this.video.play().catch(() => undefined);
    const BD = (window as any).BarcodeDetector;
    if (BD) {
      try {
        const formats: string[] = await BD.getSupportedFormats?.();
        if (!formats || formats.includes('qr_code')) this.detector = new BD({ formats: ['qr_code'] });
      } catch {
        this.detector = null;
      }
    }
    // jsQR (~130 kB) is downloaded at once on browsers without a native QR detector (iPhone), otherwise only if the
    // native one stays silent: on phones without Google services (Huawei/HarmonyOS) it may exist but never detect.
    if (!this.detector) this.jsQR = (await import('jsqr')).default;
    this.started = Date.now();
    this.loop();
  }

  private started = 0;
  private frame = 0;
  private loadingJsQR = false;

  private useJsQR() {
    if (!this.jsQR && !this.loadingJsQR) {
      this.loadingJsQR = true;
      import('jsqr').then((m) => (this.jsQR = m.default)).catch(() => (this.loadingJsQR = false));
    }
  }

  private loop = async () => {
    if (this.stopped) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth) {
      this.frame++;
      let text: string | undefined;
      if (this.detector) {
        try {
          text = (await this.detector.detect(v))[0]?.rawValue;
        } catch {
          this.detector = null;
          this.useJsQR();
        }
      }
      // Without a native detector every frame goes to jsQR; with one, every other frame after 1.5 s of silence.
      if (!text && (!this.detector || (Date.now() - this.started > 1500 && this.frame % 2 === 0))) {
        this.useJsQR();
        text = this.decodeFrame();
      }
      if (text && !this.stopped && this.onResult(text)) return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private decodeFrame(): string | undefined {
    const v = this.video;
    if (!this.jsQR) return undefined;
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(v, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    // 'attemptBoth' also reads light-on-dark codes (e.g. a poster photographed under glare).
    return this.jsQR(img.data, w, h, { inversionAttempts: this.frame % 3 === 0 ? 'attemptBoth' : 'dontInvert' })?.data;
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
