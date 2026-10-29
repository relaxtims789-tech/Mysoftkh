// Makes qr-attendance-deploy.zip: the source needed to build on a server (Docker builds everything there).
// Leaves out node_modules, builds, local data/backups, secrets and logs.   npm run package
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qr-attendance-deploy.zip');
const INCLUDE = ['apps', 'tools', 'docs', 'package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'docker-compose.yml', 'Caddyfile', '.env.example', 'README.md', '.gitignore', 'start.bat', 'start-demo.bat', 'setup.sh', '.gitattributes'];
const EXCLUDE = ['node_modules', 'dist', 'coverage', '*.log', '.env', 'data', 'backups'];

// Windows 10+ ships bsdtar, which writes zip files; Git Bash's GNU tar does not, so call it by full path.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
fs.rmSync(OUT, { force: true });
const args = ['-a', '-c', '-f', OUT, ...EXCLUDE.flatMap((e) => ['--exclude', e]), ...INCLUDE.filter((f) => fs.existsSync(path.join(ROOT, f)))];
const r = spawnSync(tar, args, { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('Packaging failed.');
  process.exit(1);
}
console.log(`Created ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB). Upload it to the server and unzip it there (see docs/DEPLOY.md).`);
