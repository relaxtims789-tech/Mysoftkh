// Local PostgreSQL for development and the Windows "start.bat" set-up, using the embedded-postgres npm package
// (real PostgreSQL binaries, no installer). Production uses a normal PostgreSQL server via DATABASE_URL.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PG_PORT = Number(process.env.PG_PORT || 54330);
export const PG_DIR = path.resolve(process.env.PG_DIR || path.join(ROOT, 'data', 'pg'));
export const DB_NAME = 'qr_attendance';
export const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${DB_NAME}`;

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

/** True when the server on the port actually answers a query (a half-dead PostgreSQL can keep the port open). */
async function answers() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DATABASE_URL.replace(/\/[^/]+$/, '/postgres'), connectionTimeoutMillis: 4000, query_timeout: 4000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    client.end().catch(() => {});
  }
}

/**
 * Stops PostgreSQL processes left over from this project's earlier run (e.g. the start.bat window was closed with X).
 * Only processes started from this repository's embedded-postgres binaries are touched.
 */
export function killLeftovers(log) {
  const exe = path.join(ROOT, 'node_modules', '@embedded-postgres');
  try {
    if (process.platform === 'win32') {
      // Command lines use forward slashes for the embedded binaries; compare both forms in lower case.
      const needle = exe.replaceAll('\\', '/').toLowerCase();
      const ps = `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace([char]92,[char]47).ToLower().Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
    } else {
      execFileSync('pkill', ['-f', exe], { stdio: 'ignore' });
    }
  } catch {
    /* nothing to stop */
  }
  log('PostgreSQL is not answering; stopped processes left over from an earlier run.');
}

/** Starts (or reuses an already running) local PostgreSQL and makes sure the app database exists. */
export async function startPostgres({ log = console.log } = {}) {
  if (await portOpen(PG_PORT)) {
    if (await answers()) {
      log(`PostgreSQL already running on port ${PG_PORT}`);
      return { url: DATABASE_URL, stop: async () => {} };
    }
    killLeftovers(log);
    for (let i = 0; i < 20 && (await portOpen(PG_PORT)); i++) await new Promise((r) => setTimeout(r, 500));
    if (await portOpen(PG_PORT)) throw new Error(`Port ${PG_PORT} is busy and not answering. Restart the PC or set PG_PORT to another port.`);
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const fresh = !fs.existsSync(path.join(PG_DIR, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DIR, user: 'postgres', password: 'postgres', port: PG_PORT, persistent: true,
    // UTF-8 whatever the Windows language is (otherwise Khmer text cannot be stored)
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {}, onError: (e) => log(String(e)),
  });
  if (fresh) {
    log(`Creating local PostgreSQL data folder ${PG_DIR} (first run takes a minute)...`);
    fs.mkdirSync(path.dirname(PG_DIR), { recursive: true });
    await pg.initialise();
  }
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (!exists.rowCount) await client.query(`CREATE DATABASE ${DB_NAME} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
  await client.end();
  log(`PostgreSQL running on port ${PG_PORT} (data: ${PG_DIR})`);
  let stopped = false;
  return {
    url: DATABASE_URL,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await pg.stop();
    },
  };
}
