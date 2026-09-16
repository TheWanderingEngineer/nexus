/* Recovery and preference regressions; no server or browser required. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(path.join(root, '.nexus-gui-check-'));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function appearance(saved = {}, blocked = false) {
  const attrs = {}, values = new Map(Object.entries(saved));
  const context = {
    document: { documentElement: { dataset: attrs }, querySelector: () => ({}), dispatchEvent() {} },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('Storage blocked'); return values.get(key) ?? null; },
      setItem(key, val) { if (blocked) throw new Error('Storage blocked'); values.set(key, val); }
    },
    window: {}, CustomEvent: class {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'web/appearance.js'), 'utf8'), context);
  return { api: context.window.NexusAppearance, attrs, values };
}
try {
  check('new browser defaults to Parchment before paint', () => {
    assert.equal(appearance().attrs.palette, 'parchment');
    assert.equal(appearance().attrs.theme, 'light');
  });
  check('existing dark preference migrates without overwriting Classic preference', () => {
    const a = appearance({ 'nexus.theme': 'dark' });
    assert.equal(a.attrs.palette, 'midnight');
    a.api.setPalette('parchment'); a.api.setClassic(true);
    assert.equal(a.attrs.theme, 'dark');
  });
  check('palette persists and survives a reload', () => {
    const a = appearance(); a.api.setPalette('evergreen');
    const b = appearance(Object.fromEntries(a.values));
    assert.equal(b.attrs.palette, 'evergreen'); assert.equal(b.attrs.theme, 'dark');
  });
  check('Classic return preserves selected palette', () => {
    const a = appearance(); a.api.setPalette('midnight'); a.api.setClassic(true);
    assert.equal(a.attrs.gui, 'classic'); a.api.setClassic(false);
    assert.equal(a.attrs.palette, 'midnight'); assert.equal(a.attrs.gui, 'workstation');
  });
  check('invalid saved palette is safe; unrecognized setters do nothing', () => {
    const a = appearance({ 'nexus.palette': '__proto__' });
    assert.equal(a.attrs.palette, 'parchment'); a.api.setPalette('missing');
    assert.equal(a.attrs.palette, 'parchment');
  });
  check('blocked localStorage does not break appearance', () => {
    const a = appearance({}, true); a.api.setPalette('evergreen'); a.api.setMotion('reduced');
    assert.equal(a.attrs.palette, 'evergreen'); assert.equal(a.attrs.motion, 'reduced');
  });
  fs.mkdirSync(path.join(scratch, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/gui-backup.js'), path.join(scratch, 'scripts/gui-backup.mjs'));
  fs.cpSync(path.join(root, 'backups/gui/before-workstation'), path.join(scratch, 'backups/gui/before-workstation'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'web')); fs.mkdirSync(path.join(scratch, 'assets'));
  fs.writeFileSync(path.join(scratch, 'web/index.html'), 'Outgoing GUI');
  fs.writeFileSync(path.join(scratch, 'config.json'), 'KEEP CONFIG');
  const run = args => spawnSync(process.execPath, [path.join(scratch, 'scripts/gui-backup.mjs'), ...args], { encoding: 'utf8', timeout: 60000 });
  check('dry-run verifies original files without changing current GUI', () => {
    const r = run(['restore', '--check']); assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(scratch, 'web/index.html'), 'utf8'), 'Outgoing GUI');
  });
  check('restore reinstates original GUI and saves outgoing files', () => {
    const r = run(['restore']); assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readFileSync(path.join(scratch, 'web/index.html')), fs.readFileSync(path.join(root, 'backups/gui/before-workstation/files/web/index.html')));
    const rescue = fs.readdirSync(path.join(scratch, 'backups/gui')).find(n => n.startsWith('before-restore-'));
    assert.equal(fs.readFileSync(path.join(scratch, 'backups/gui', rescue, 'files/web/index.html'), 'utf8'), 'Outgoing GUI');
    assert.equal(fs.readFileSync(path.join(scratch, 'config.json'), 'utf8'), 'KEEP CONFIG');
  });
  check('corrupt backup aborts before changing current GUI', () => {
    fs.writeFileSync(path.join(scratch, 'backups/gui/before-workstation/files/web/index.html'), 'Corrupt');
    const before = fs.readFileSync(path.join(scratch, 'web/index.html'));
    assert.notEqual(run(['restore']).status, 0);
    assert.deepEqual(fs.readFileSync(path.join(scratch, 'web/index.html')), before);
  });
  console.log(`${checks} GUI checks passed.`);
} finally {
  // Only the exact scratch directory created above, inside this repository.
  if (path.dirname(scratch) !== root || !path.basename(scratch).startsWith('.nexus-gui-check-')) throw new Error('Unsafe scratch path');
  fs.rmSync(scratch, { recursive: true, force: true });
}
