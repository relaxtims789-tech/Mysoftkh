// tsc does not copy non-TS files; the migration runner reads the .sql files from dist/.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', 'src', 'database', 'migrations');
const to = path.join(__dirname, '..', 'dist', 'database', 'migrations');
fs.mkdirSync(to, { recursive: true });
for (const f of fs.readdirSync(from)) if (f.endsWith('.sql')) fs.copyFileSync(path.join(from, f), path.join(to, f));
