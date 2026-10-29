// Screen capture for the guide videos (headless Chrome over CDP). Usage: node cap.mjs steps.json outDir
// Steps: {viewport:[w,h], scale, ua, geo:[lat,lng], url, wait, set:[[sel,val],...], click:"sel" | "text:Label",
//         js, log, box:{name:sel|"text:Label"}, shot:"name.png", after}
// Element boxes (CSS px) are written to outDir/boxes.json for the pointer in the video.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const boxFile = path.join(outDir, 'boxes.json');
const boxes = fs.existsSync(boxFile) ? JSON.parse(fs.readFileSync(boxFile, 'utf8')) : {};
const port = 9335;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qra-cap-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--disable-gpu',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--lang=en-US', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) console.log('JS error:', r.exceptionDetails.exception?.description?.slice(0, 300) ?? r.exceptionDetails.text);
  return r?.result?.value;
};
// Helpers inside the page: find by CSS or by visible text; set a React-controlled value.
const HELPERS = `
window.__find = (q) => {
  if (!q.startsWith('text:')) return document.querySelector(q);
  const t = q.slice(5).trim();
  const all = [...document.querySelectorAll('button, a, label, [role=button], .tab, h1, h2, h3, summary, input, select')];
  return all.find((e) => (e.innerText || e.value || '').trim() === t) || all.find((e) => (e.innerText || '').trim().includes(t));
};
window.__set = (q, v) => {
  const el = window.__find(q); if (!el) throw new Error('not found ' + q);
  if (el.type === 'checkbox') { if (el.checked !== v) el.click(); return; }
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
};
window.__box = (q) => { const el = window.__find(q); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
`;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS + "Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>false});" });
let vp = [1280, 800];
let scale = 1;
for (const s of steps) {
  if (s.viewport) { vp = s.viewport; scale = s.scale ?? 1; await send('Emulation.setDeviceMetricsOverride', { width: vp[0], height: vp[1], deviceScaleFactor: scale, mobile: vp[0] < 600 }); }
  if (s.ua) await send('Emulation.setUserAgentOverride', { userAgent: s.ua });
  if (s.geo) {
    await send('Browser.grantPermissions', { permissions: ['geolocation', 'videoCapture'] });
    await send('Emulation.setGeolocationOverride', { latitude: s.geo[0], longitude: s.geo[1], accuracy: 12 });
  }
  if (s.url) { await send('Page.navigate', { url: s.url }); await sleep(s.wait ?? 1800); await evaluate(HELPERS); }
  for (const [q, v] of s.set ?? []) { await evaluate(`window.__set(${JSON.stringify(q)}, ${JSON.stringify(v)})`); await sleep(80); }
  if (s.box) for (const [name, q] of Object.entries(s.box)) { boxes[name] = await evaluate(`window.__box(${JSON.stringify(q)})`); if (!boxes[name]) console.log('box not found:', name, q); }
  if (s.js) { const v = await evaluate(s.js); if (s.log) console.log(s.log, JSON.stringify(v)?.slice(0, 300)); if (s.save) fs.writeFileSync(path.join(outDir, s.save), Buffer.from(v, 'base64')); }
  if (s.click) { const ok = await evaluate(`(()=>{const e=window.__find(${JSON.stringify(s.click)}); if(!e) return false; e.click(); return true})()`); if (!ok) console.log('click target not found:', s.click); }
  if (s.after || s.click) await sleep(s.after ?? 1200);
  if (s.shot && s.morning) {
    // Captured in the evening: show the schedule and times as a normal office morning (08:00-17:00).
    await evaluate(`(()=>{
      const fixed=[['09:10 PM','08:00 AM'],['11:59 PM','05:00 PM'],['09:25 PM','08:15 AM'],['21:10','08:00'],['23:59','17:00'],['21:25','08:15'],['Good evening','Good morning'],['No check-out',''],['ABSENT','NOT CHECKED IN']];
      const shift=(h,m)=>{const t=h*60+m-800;return [Math.floor(t/60),t%60]};
      const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
      while((n=w.nextNode())){let v=n.nodeValue;for(const [a,b] of fixed)v=v.split(a).join(b);
        v=v.replace(/\\b(0?9|1[01]):([0-5]\\d) PM\\b/g,(x,h,m)=>{const [H,M]=shift(Number(h)+12,Number(m));return String(H).padStart(2,'0')+':'+String(M).padStart(2,'0')+' AM'});
        v=v.replace(/\\b(2[1-3]):([0-5]\\d)\\b/g,(x,h,m)=>{const [H,M]=shift(Number(h),Number(m));return String(H).padStart(2,'0')+':'+String(M).padStart(2,'0')});
        if(v!==n.nodeValue)n.nodeValue=v;}
    })()`);
  }
  if (s.shot) {
    // Show the real web address instead of the local test server.
    await evaluate(`(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))if(n.nodeValue.includes('localhost:3200'))n.nodeValue=n.nodeValue.replace(/https?:\\/\\/localhost:3200/g,'https://attendance.mysoftkh.com').replace(/localhost:3200/g,'attendance.mysoftkh.com');document.querySelectorAll('input').forEach(i=>{if(i.value.includes('localhost:3200'))i.value=i.value.replace(/https?:\\/\\/localhost:3200/g,'https://attendance.mysoftkh.com')})})()`);
    // The clip is in page coordinates: take what is on screen now (boxes are viewport-relative).
    const sy = Number(await evaluate('window.scrollY')) || 0;
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: sy, width: vp[0], height: vp[1], scale: 1 } });
    fs.writeFileSync(path.join(outDir, s.shot), Buffer.from(r.result.data, 'base64'));
    console.log('saved', s.shot);
  }
}
fs.writeFileSync(boxFile, JSON.stringify(boxes, null, 1));
ws.close();
chrome.kill();
