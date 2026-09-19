/* Dashboard layout check — `npm run dash:check`.
 *
 * The bug this exists for: go to Files, open a folder, come back to the
 * Dashboard, and every widget is piled on top of every other one. A hidden page
 * has clientWidth 0, so the cell width came out NEGATIVE and every widget was
 * written to the same broken position — and the window `resize` listener fires
 * while you are on another page, because a long folder listing adds a scrollbar.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-dash-'));
const share = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-dashshare-'));
for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(share, `file-${i}.txt`), 'x\n');
fs.mkdirSync(path.join(share, 'deep'));
for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(share, 'deep', `f-${i}.txt`), 'x\n');
const conf = path.join(dataDir, 'config.json');
fs.writeFileSync(conf, JSON.stringify({ fileRoots: [{ name: 'DATA', path: share }], terminal: { enabled: false } }));

const PORT = 8841, base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { cwd: ROOT,
  env: { ...process.env, NEXUS_PORT: String(PORT), NEXUS_HOST: '127.0.0.1', NEXUS_DATA_DIR: dataDir, NEXUS_CONFIG: conf },
  stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', d => process.stderr.write('[srv!] ' + d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('PASS ' + n)) : (fail++, console.log('FAIL ' + n + (x ? ' — ' + x : ''))); };

/** Every widget's box, and whether any two of them overlap. */
const geometry = page => page.evaluate(() => {
  const box = [...document.querySelectorAll('#grid .w')].map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  let overlaps = 0;
  for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
    const a = box[i], b = box[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps++;
  }
  return { box, overlaps, tiny: box.filter(b => b.w < 40 || b.h < 40).length,
           offscreen: box.filter(b => b.x < -1).length };
});

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await sleep(500); }
  const s = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dh', password: 'dh-password-1234' }) });
  const raw = (s.headers.getSetCookie?.() || []);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(raw.map(c => { const [p] = c.split(';'); const i = p.indexOf('=');
    return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: '127.0.0.1', path: '/' }; }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await sleep(3000);

  const before = await geometry(page);
  ok('the dashboard starts with no overlapping widgets', before.overlaps === 0, before.overlaps + ' overlaps');
  ok('every widget has a real size', before.tiny === 0 && before.offscreen === 0,
     `${before.tiny} tiny, ${before.offscreen} off-screen`);

  /* The invariant itself, tested where it actually lives.
     Navigating away and back is now repaired by a ResizeObserver, which is
     good but means the round trip alone cannot prove the guard works — it
     masks the damage before anything can look at it. So: go to another page
     and call layout() directly, exactly as the window resize listener does
     when a long folder listing adds a scrollbar, and check that it declined
     to write anything rather than writing nonsense. */
  await page.click('.nav[data-page="files"]');
  await sleep(1200);
  const hiddenWrite = await page.evaluate(() => {
    const all = () => [...document.querySelectorAll('#grid .w')]
      .map(el => `${el.id}:${el.style.left}|${el.style.top}|${el.style.width}|${el.style.height}`);
    const was = all();
    const gridW = document.getElementById('grid').clientWidth;
    dispatchEvent(new Event('resize'));
    const now = all();
    // A negative `width` is invalid CSS and is silently rejected, so the first
    // widget (x=0) looks untouched even when the layout is destroyed. `left`
    // accepts negatives happily, which is what actually piles them up — so
    // look at every widget, not the first one.
    const negLeft = [...document.querySelectorAll('#grid .w')]
      .filter(el => parseFloat(el.style.left) < 0).length;
    return { gridW, was, now, negLeft,
             changed: was.filter((v, i) => v !== now[i]) };
  });
  ok('the canvas really is unmeasurable while hidden', hiddenWrite.gridW === 0, 'grid width ' + hiddenWrite.gridW);
  ok('a resize while the dashboard is hidden writes nothing',
     hiddenWrite.changed.length === 0,
     `${hiddenWrite.changed.length} widgets rewritten: ${hiddenWrite.changed.slice(0, 2).join(' , ')}`);
  ok('no widget is given a negative position', hiddenWrite.negLeft === 0,
     hiddenWrite.negLeft + ' widgets pushed off the left edge');
  await page.click('.nav[data-page="dash"]');
  await sleep(900);

  // The reported route: Files, open a folder, come back.
  await page.click('.nav[data-page="files"]');
  await sleep(1800);
  await page.evaluate(() => [...document.querySelectorAll('#f-table tbody tr')]
    .find(tr => tr.dataset.dir === '1')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(1800);
  // ...and the thing that actually broke it: a resize while the page is hidden.
  await page.setViewportSize({ width: 1200, height: 860 });
  await sleep(600);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(600);
  await page.click('.nav[data-page="dash"]');
  await sleep(1500);

  const after = await geometry(page);
  ok('coming back from Files leaves no widgets stacked', after.overlaps === 0, after.overlaps + ' overlaps');
  ok('coming back leaves every widget its real size', after.tiny === 0, after.tiny + ' collapsed');
  ok('no widget is pushed off the left edge', after.offscreen === 0, after.offscreen + ' off-screen');
  ok('the layout is the same one you left', JSON.stringify(after.box) === JSON.stringify(before.box),
     'geometry changed across the round trip');

  // Rail collapse is the same class of event: the canvas resizes, the window does not.
  await page.click('#rail-toggle'); await sleep(900);
  const narrowRail = await geometry(page);
  ok('collapsing the rail re-lays out rather than breaking', narrowRail.overlaps === 0 && narrowRail.tiny === 0);
  await page.click('#rail-toggle'); await sleep(900);

  // TIDY packs with no gaps and keeps everything on the canvas.
  await page.evaluate(() => {
    // Scatter first, so tidying has something to do.
    const el = document.querySelector('#grid .w');
    el.style.left = '900px'; el.style.top = '900px';
  });
  await page.click('#tidy');
  await sleep(900);
  const tidied = await geometry(page);
  ok('TIDY leaves no overlaps', tidied.overlaps === 0, tidied.overlaps + ' overlaps');
  const topRow = tidied.box.filter(b => b.y === Math.min(...tidied.box.map(x => x.y)));
  ok('TIDY packs against the top', topRow.length >= 2, topRow.length + ' widgets on the top row');

  // Presets: save, change, switch back.
  await page.click('#presets'); await sleep(700);
  await page.fill('#pz-name', 'Everything');
  await page.click('#pz-add'); await sleep(1200);
  ok('a preset can be saved', (await page.$$('.pz-item')).length === 1);
  await page.click('#mw-close'); await sleep(400);   // one way out: the X

  const count0 = (await geometry(page)).box.length;
  await page.evaluate(() => document.querySelector('#grid .w .w-x').click());
  await sleep(800);
  const count1 = (await geometry(page)).box.length;
  ok('removing a widget changes the dashboard', count1 === count0 - 1, `${count0} -> ${count1}`);

  await page.click('#presets'); await sleep(900);
  await page.click('[data-pz-use]'); await sleep(1500);
  const restored = await geometry(page);
  ok('using the preset puts the widget back', restored.box.length === count0, `${restored.box.length} vs ${count0}`);
  ok('the restored layout has no overlaps', restored.overlaps === 0);

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally {
  srv.kill('SIGTERM'); await sleep(300);
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(share, { recursive: true, force: true });
}
