/** Portable GUI snapshots. Never touches host config, accounts, or layouts. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.join(root, 'backups', 'gui');
const baseline = path.join(archive, 'before-workstation');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function safe(base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base) + path.sep)) throw new Error('Unsafe backup path');
  return target;
}
function files(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('GUI backup refuses symbolic links');
    const rel = path.join(prefix, entry.name);
    return entry.isDirectory() ? files(path.join(dir, entry.name), rel) : [rel];
  });
}
function snapshot(destination) {
  if (fs.existsSync(destination)) throw new Error('Snapshot already exists; refusing to overwrite');
  const entries = ['web', 'assets'].flatMap(dir => files(path.join(root, dir)).map(f => path.join(dir, f)));
  const manifest = { version: 1, created: new Date().toISOString(), files: [] };
  for (const name of entries) {
    const bytes = fs.readFileSync(safe(root, name));
    const dest = safe(path.join(destination, 'files'), name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    manifest.files.push({ path: name.replaceAll('\\', '/'), sha256: hash(bytes) });
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
function verify() {
  const manifest = JSON.parse(fs.readFileSync(path.join(baseline, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.files.length) throw new Error('Invalid backup manifest');
  for (const entry of manifest.files) {
    if (!/^(web|assets)\//.test(entry.path)) throw new Error('Unexpected backup scope');
    const bytes = fs.readFileSync(safe(path.join(baseline, 'files'), entry.path));
    if (hash(bytes) !== entry.sha256) throw new Error('Backup checksum mismatch: ' + entry.path);
    safe(root, entry.path);
  }
  return manifest;
}
const action = process.argv[2];
try {
  if (action === 'create') {
    const m = snapshot(baseline);
    console.log(`Backed up ${m.files.length} GUI files to ${baseline}`);
  } else if (action === 'verify') {
    console.log(`Verified ${verify().files.length} original GUI files (SHA-256).`);
  } else if (action === 'restore') {
    const manifest = verify(); // Verify everything before any original file is replaced.
    if (process.argv.includes('--check')) {
      console.log(`Restore ready: ${manifest.files.length} verified files. No files changed.`);
    } else {
      const rescue = path.join(archive, 'before-restore-' + Date.now());
      snapshot(rescue);
      for (const entry of manifest.files) {
        const target = safe(root, entry.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(safe(path.join(baseline, 'files'), entry.path), target);
        if (hash(fs.readFileSync(target)) !== entry.sha256) throw new Error('Restore verification failed: ' + entry.path);
      }
      console.log(`Original GUI restored and verified. Refresh the browser. Outgoing GUI saved at ${rescue}`);
    }
  } else throw new Error('Usage: node scripts/gui-backup.js create|verify|restore [--check]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
