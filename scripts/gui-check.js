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
const { peerMatches } = await import('../server/netmatch.js');

try {
  check('trusted-proxy patterns match the way the docs say they do', () => {
    // CIDR — the form the README tells people to use for a Docker network.
    assert.equal(peerMatches('172.18.0.5', '172.18.0.0/16'), true);
    assert.equal(peerMatches('::ffff:172.18.0.5', '172.18.0.0/16'), true);
    assert.equal(peerMatches('172.19.0.5', '172.18.0.0/16'), false);
    assert.equal(peerMatches('10.1.2.3', '10.0.0.0/8'), true);
    assert.equal(peerMatches('11.1.2.3', '10.0.0.0/8'), false);
    // Exact, loopback, dotted prefix.
    assert.equal(peerMatches('192.168.1.50', '192.168.1.50'), true);
    assert.equal(peerMatches('127.0.0.1', 'localhost'), true);
    assert.equal(peerMatches('::1', 'localhost'), true);
    assert.equal(peerMatches('192.168.1.7', '192.168.'), true);
    // The old substring match trusted this. It must not.
    assert.equal(peerMatches('110.0.0.1', '10.0.0.1'), false);
    assert.equal(peerMatches('8.8.8.8', '192.168.0.0/16'), false);
    assert.equal(peerMatches('172.18.0.5', ''), false);
    assert.equal(peerMatches('', '172.18.0.0/16'), false);
  });
  check('new browser defaults to Modern (graphite, dark, glass) before paint', () => {
    const a = appearance();
    assert.equal(a.attrs.skin, 'modern');
    assert.equal(a.attrs.gui, 'workstation');      // Modern refines the workstation geometry
    assert.equal(a.attrs.palette, 'graphite');
    assert.equal(a.attrs.theme, 'dark');
    assert.equal(a.attrs.accent, 'indigo');
    assert.equal(a.attrs.glass, 'on');
  });
  check('an old saved "workstation" GUI does not keep a browser off the new design', () => {
    const a = appearance({ 'nexus.gui': 'workstation', 'nexus.palette': 'evergreen' });
    assert.equal(a.attrs.skin, 'modern');
    a.api.setSkin('workstation');
    assert.equal(a.attrs.palette, 'evergreen');    // the old palette choice is still there
  });
  check('mode, accent and glass persist and survive a reload', () => {
    const a = appearance(); a.api.setMode('light'); a.api.setAccent('teal'); a.api.setGlass(false);
    const b = appearance(Object.fromEntries(a.values));
    assert.equal(b.attrs.theme, 'light'); assert.equal(b.attrs.palette, 'daylight');
    assert.equal(b.attrs.accent, 'teal'); assert.equal(b.attrs.glass, 'off');
  });
  check('existing dark preference migrates without overwriting Classic preference', () => {
    const a = appearance({ 'nexus.theme': 'dark' });
    assert.equal(a.api.palette, 'midnight');
    a.api.setPalette('parchment'); a.api.setClassic(true);
    assert.equal(a.attrs.theme, 'dark');
    assert.equal(a.attrs.glass, 'off');            // the pixel theme never blurs
  });
  check('workstation palette persists and survives a reload', () => {
    const a = appearance(); a.api.setPalette('evergreen');
    const b = appearance(Object.fromEntries(a.values));
    assert.equal(b.attrs.skin, 'workstation');
    assert.equal(b.attrs.palette, 'evergreen'); assert.equal(b.attrs.theme, 'dark');
  });
  check('leaving Classic returns to Modern and keeps the workstation palette', () => {
    const a = appearance(); a.api.setPalette('midnight'); a.api.setClassic(true);
    assert.equal(a.attrs.gui, 'classic'); a.api.setClassic(false);
    assert.equal(a.attrs.skin, 'modern'); assert.equal(a.attrs.gui, 'workstation');
    a.api.setSkin('workstation');
    assert.equal(a.attrs.palette, 'midnight');
  });
  check('invalid saved values are safe; unrecognized setters do nothing', () => {
    const a = appearance({ 'nexus.palette': '__proto__', 'nexus.skin': 'constructor', 'nexus.accent': 'toString', 'nexus.mode': 'x' });
    assert.equal(a.attrs.skin, 'modern'); assert.equal(a.attrs.accent, 'indigo'); assert.equal(a.attrs.theme, 'dark');
    a.api.setPalette('missing'); a.api.setSkin('missing'); a.api.setAccent('missing'); a.api.setMode('missing');
    assert.equal(a.attrs.skin, 'modern'); assert.equal(a.api.palette, 'parchment');
  });
  check('blocked localStorage does not break appearance', () => {
    const a = appearance({}, true); a.api.setPalette('evergreen'); a.api.setMotion('reduced');
    assert.equal(a.attrs.palette, 'evergreen'); assert.equal(a.attrs.motion, 'reduced');
    a.api.setMode('light');
    assert.equal(a.attrs.theme, 'light');
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
