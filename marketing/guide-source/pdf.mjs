// Print guide.html to A4 PDFs with headless Chrome. Usage: node pdf.mjs outDir [g02 g03 ... | all | each]
// "each" = one PDF per guide + the full manual.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const outDir = process.argv[2];
let ids = process.argv.slice(3);
fs.mkdirSync(outDir, { recursive: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(path.join(here, 'guide.html')).href;
const port = Number(process.env.CDP_PORT || 9336);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qra-pdf-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--allow-file-access-from-files', 'about:blank',
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
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');

async function load(g) {
  await send('Page.navigate', { url: `${page}?g=${g}&img=${process.env.IMG_DIR || 'jpg'}` });
  await sleep(800);
  for (let i = 0; i < 40 && !(await evaluate('!!window.__ready')); i++) await sleep(150);
  await evaluate('window.__ready.then(() => 1)');
  await sleep(300);
}
const FOOT = `<div style="width:100%;font:7.5pt 'Segoe UI','Khmer UI',sans-serif;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between">
  <span>MySoft Attendance · www.mysoftkh.com · Telegram @mysoftkh · 014 789 987 · 096 89 99 169</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
async function print(file) {
  const r = await send('Page.printToPDF', {
    paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: FOOT,
  });
  if (!r.result) throw new Error(JSON.stringify(r.error));
  fs.writeFileSync(path.join(outDir, file), Buffer.from(r.result.data, 'base64'));
  console.log('saved', file);
}

const list = JSON.parse(await (async () => { await load('all'); return evaluate('JSON.stringify(GUIDES.map(g=>({id:g.id,n:g.n,file:g.file})).sort((a,b)=>a.n-b.n))'); })());
if (!ids.length || ids[0] === 'each') ids = [...list.map((g) => g.id), 'all'];
for (const g of ids) {
  if (g === 'all') { await load('all'); await print('00-MySoft-Attendance-User-Guide-Khmer.pdf'); continue; }
  const meta = list.find((x) => x.id === g);
  if (!meta) { console.log('no guide', g); continue; }
  await load(g);
  await print(`${meta.file}.pdf`);
}
ws.close();
chrome.kill();
