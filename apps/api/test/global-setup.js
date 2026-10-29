// Starts a throw-away PostgreSQL for the integration tests (or uses TEST_DATABASE_URL when set, e.g. in CI).
const os = require('os');
const path = require('path');
const fs = require('fs');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qra-test-storage-'));
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return;
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  // A free port each run, so a database left over from an interrupted run can never block the tests.
  const port = await new Promise((resolve, reject) => {
    const srv = require('net').createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qra-test-pg-'));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {}, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('qra_test');
  globalThis.__QRA_PG__ = pg;
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/qra_test`;
};
