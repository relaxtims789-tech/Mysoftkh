import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { config } from '../config';
import { hashPassword } from '../common/crypto';

/** Applies migrations/NNN_name.sql in order, each in its own transaction, recording them in schema_migrations. */
export async function runMigrations(pool: Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    // Two app instances starting together must not both migrate.
    await client.query('SELECT pg_advisory_lock(727274)');
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`migrated ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(727274)');
  } finally {
    client.release();
  }
  return applied;
}

/** Creates the first super admin from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD when none exists. */
export async function ensureSuperAdmin(pool: Pool, log: (msg: string) => void = console.log) {
  if (!config.superAdminEmail || !config.superAdminPassword) return;
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1`);
  if (rows.length) return;
  await pool.query(
    `INSERT INTO users (company_id, username, email, name, role, password_hash, must_change_password)
     VALUES (NULL, $1, $1, 'Super Admin', 'super_admin', $2, true)`,
    [config.superAdminEmail.toLowerCase(), await hashPassword(config.superAdminPassword)],
  );
  log(`created super admin ${config.superAdminEmail}`);
}

if (require.main === module) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  runMigrations(pool)
    .then((applied) => {
      if (!applied.length) console.log('database is up to date');
      return ensureSuperAdmin(pool);
    })
    .then(() => pool.end())
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
