// One command for local use:  node tools/run.mjs [start|seed|reset|dev|db]
//   start  local PostgreSQL + API serving the built web app on http://localhost:3200
//   seed   add the demo company (camdemo) if missing, then exit
//   reset  wipe the local database and seed the demo again, then exit
//   dev    PostgreSQL + API (auto-rebuild/restart) + Vite dev server with hot reload on :5173
//   db     only PostgreSQL (for running the API or tests yourself)
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startPostgres } from './pg.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'apps', 'api');
const mode = process.argv[2] || 'start';
const extra = process.argv.slice(3);
const children = [];

function run(cmd, args, opts = {}) {
  const env = { ...process.env, ...opts.env };
  // node runs directly; npm/npx are .cmd scripts on Windows and need a shell (passed as one string).
  const child = cmd === 'node'
    ? spawn(process.execPath, args, { stdio: 'inherit', ...opts, env })
    : spawn([cmd, ...args].join(' '), { stdio: 'inherit', shell: true, ...opts, env });
  children.push(child);
  return child;
}
function wait(child) {
  return new Promise((resolve, reject) => child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`)))));
}

const pg = await startPostgres();
const env = { DATABASE_URL: pg.url };
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (!c.killed) c.kill();
  await pg.stop().catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  const needBuild = !fs.existsSync(path.join(API, 'dist', 'main.js'));
  if (mode === 'seed' || mode === 'reset') {
    if (needBuild) await wait(run('npm', ['run', 'build', '-w', 'apps/api'], { cwd: ROOT }));
    await wait(run('node', ['dist/database/seed.js', ...(mode === 'reset' ? ['--reset'] : []), ...extra], { cwd: API, env }));
    await shutdown(0);
  } else if (mode === 'start') {
    if (needBuild) await wait(run('npm', ['run', 'build'], { cwd: ROOT }));
    const api = run('node', ['dist/main.js'], { cwd: API, env });
    api.on('exit', (code) => shutdown(code ?? 0));
  } else if (mode === 'dev') {
    await wait(run('npm', ['run', 'build', '-w', 'apps/api'], { cwd: ROOT }));
    run('npx', ['tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { cwd: API });
    run('node', ['--watch-path=dist', 'dist/main.js'], { cwd: API, env });
    run('npm', ['run', 'dev', '-w', 'apps/web'], { cwd: ROOT });
  } else if (mode === 'db') {
    console.log(`DATABASE_URL=${pg.url}\nPress Ctrl+C to stop.`);
  } else {
    console.error(`Unknown mode "${mode}". Use start, seed, reset, dev or db.`);
    await shutdown(1);
  }
} catch (e) {
  console.error(e.message);
  await shutdown(1);
}
