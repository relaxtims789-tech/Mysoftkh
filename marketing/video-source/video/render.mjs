// Renders a guide video: node render.mjs v1 [frames|preview|record] [outDir]
//   frames  - render each scene's base + caption layer to PNG and its pointer target to meta.json
//   preview - contact sheet stills at chosen times (frames/<v>/preview-*.jpg)
//   record  - play the scenes in Chrome and record an H.264 MP4 into outDir
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..'); // scratchpad: video/, v1/, v2/
const [, , key, mode = 'all', outDir = DIR] = process.argv;

// Static server, so canvas images are same-origin (a tainted canvas cannot be recorded).
const TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const port = 9336;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qra-vid-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r?.result?.value;
};
await send('Page.enable');

global.window = {};
await import(`file://${path.join(DIR, 'scenes.js').replace(/\\/g, '/')}?${Date.now()}`);
const V = global.window.VIDEOS[key];
const [W, H] = V.size;
const frames = path.join(DIR, 'frames', key);
fs.mkdirSync(frames, { recursive: true });

async function go(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate('document.readyState === "complete" && !!window.__ready').catch(() => false)) break; }
}

if (mode === 'frames' || mode === 'all') {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const meta = [];
  for (let i = 0; i < V.scenes.length; i++) {
    for (const layer of ['base', 'cap']) {
      await send('Emulation.setDefaultBackgroundColorOverride', layer === 'cap' ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
      await go(`${base}/video/${V.compose ?? 'compose.html'}?v=${key}&i=${i}&layer=${layer}`);
      await evaluate('window.__ready');
      await sleep(250);
      if (layer === 'base') meta[i] = await evaluate('window.__meta');
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
      fs.writeFileSync(path.join(frames, `${layer}-${i}.png`), Buffer.from(r.result.data, 'base64'));
    }
    process.stdout.write(`scene ${i} `);
  }
  fs.writeFileSync(path.join(frames, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log('\nframes done');
}

if (mode === 'preview') {
  const times = (process.argv[5] ?? '').split(',').filter(Boolean).map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/video/player.html?v=${key}` });
  await sleep(1500);
  for (const t of times) {
    const data = await evaluate(`window.__preview(${t})`);
    fs.writeFileSync(path.join(frames, `preview-${t}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
  console.log('previews', times.join(' '));
}

if (mode === 'record' || mode === 'all') {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const presenter = process.env.PRESENTER ? `&presenter=${encodeURIComponent(process.env.PRESENTER)}` : '';
  await send('Page.navigate', { url: `${base}/video/player.html?v=${key}${presenter}` });
  await sleep(1500);
  const info = await evaluate('window.__record()');
  console.log('recorded', info);
  const parts = [];
  const STEP = 6 * 1024 * 1024;
  for (let at = 0; at < info.size; at += STEP) parts.push(Buffer.from(await evaluate(`window.__slice(${at}, ${STEP})`), 'base64'));
  const out = path.join(outDir, V.file);
  fs.writeFileSync(out, Buffer.concat(parts));
  console.log('saved', out, (fs.statSync(out).size / 1024 / 1024).toFixed(1), 'MB');
}

ws.close();
chrome.kill();
server.close();
