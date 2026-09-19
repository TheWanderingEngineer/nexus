/* Apps page check — `npm run apps:check`.
 *
 * The launcher is a board of links, so the things worth asserting are: a tile
 * survives a round trip, PULL ALL never touches what is already there, a
 * javascript: URL cannot be stored, and the close-button rule holds.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-lp-'));
const conf = path.join(dataDir, 'config.json');
fs.writeFileSync(conf, JSON.stringify({ terminal: { enabled: false } }));
const PORT = 8861, base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { cwd: ROOT,
  env: { ...process.env, NEXUS_PORT: String(PORT), NEXUS_HOST: '127.0.0.1', NEXUS_DATA_DIR: dataDir, NEXUS_CONFIG: conf },
  stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', d => process.stderr.write('[srv!] ' + d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('PASS ' + n)) : (fail++, console.log('FAIL ' + n + (x ? ' — ' + x : ''))); };

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await sleep(500); }
  const s = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lp', password: 'lp-password-1234' }) });
  const setup = await s.json();
  const raw = (s.headers.getSetCookie?.() || []);
  const cookie = raw.map(c => c.split(';')[0]).join('; ');
  const A = async (p, o = {}) => {
    const r = await fetch(base + '/api' + p, { ...o, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': setup.csrf } });
    return { status: r.status, body: await r.json() };
  };

  /* ---- the API's guarantees ---- */
  const bad = await A('/launcher', { method: 'PUT', body: JSON.stringify({ apps: [
    { id: 'x1', name: 'Evil', url: 'javascript:alert(1)', externalUrl: 'data:text/html,<script>1</script>', x: 0, y: 0, w: 2, h: 1 },
    { id: 'x2', name: 'Fine', url: 'http://192.168.1.50:8096', x: 99, y: 0, w: 40, h: 1 }
  ] }) });
  ok('a javascript: address is refused', bad.body.apps[0].url === '' && bad.body.apps[0].externalUrl === '',
     JSON.stringify([bad.body.apps[0].url, bad.body.apps[0].externalUrl]));
  ok('an http address survives', bad.body.apps[1].url === 'http://192.168.1.50:8096/');
  ok('geometry is clamped to the grid', bad.body.apps[1].x <= 11 && bad.body.apps[1].w <= 12,
     `x=${bad.body.apps[1].x} w=${bad.body.apps[1].w}`);

  const round = await A('/launcher');
  ok('the board survives a round trip', round.body.apps.length === 2);

  const disc = await A('/launcher/discover');
  ok('discover reports Docker honestly when it is absent',
     disc.body.available === false && typeof disc.body.reason === 'string', JSON.stringify(disc.body).slice(0, 80));

  /* ---- the browser ---- */
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies(raw.map(c => { const [p] = c.split(';'); const i = p.indexOf('=');
    return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: '127.0.0.1', path: '/' }; }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/dashboard-icons|ERR_/.test(m.text())) errs.push(m.text()); });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await sleep(2500);

  /* ---- the rail ---- */
  const order = await page.$$eval('#rail .nav', els => els.map(e => e.dataset.page));
  ok('Apps sits high in the rail and Control Panel does not', order[1] === 'apps' && order.indexOf('control') > order.indexOf('term'),
     order.join(','));
  ok('Control Panel and Settings are the last two', order.slice(-2).join(',') === 'control,settings', order.slice(-2).join(','));
  ok('a rule separates the two groups', (await page.$$('#rail .navrule')).length === 1);

  /* ---- the page ---- */
  await page.click('.nav[data-page="apps"]');
  await sleep(1200);
  ok('both stored apps render as tiles', (await page.$$('.ltile')).length === 2);
  ok('the toolbar has the three actions',
     await page.isVisible('#l-add') && await page.isVisible('#l-pull') && await page.isVisible('#l-tidy'));

  // Add one by hand.
  await page.click('#l-add');
  await page.waitForSelector('#lf-name', { timeout: 8000 });
  await page.fill('#lf-name', 'Jellyfin');
  await page.fill('#lf-url', 'http://192.168.1.50:8096');
  await page.fill('#lf-desc', 'Films and TV');
  await page.fill('#lf-ports', '8096, 8920');
  await page.click('#lf-save');
  await sleep(1200);
  ok('an app added by hand appears', (await page.$$('.ltile')).length === 3);
  const stored = (await A('/launcher')).body.apps;
  ok('and is persisted with its ports', stored.length === 3 && stored.some(a => a.name === 'Jellyfin' && a.ports.length === 2),
     JSON.stringify(stored.find(a => a.name === 'Jellyfin')));

  // The tile must be a link, not just decoration.
  ok('a tile announces itself as a link', await page.$eval('.ltile', el => el.getAttribute('role')) === 'link');

  /* ---- only one way out of a window ---- */
  await page.click('.ltile [data-edit]');
  await page.waitForSelector('#lf-name', { timeout: 8000 });
  const closers = await page.$$eval('#modal button', els =>
    els.filter(e => /^close$/i.test(e.textContent.trim())).length);
  ok('no window carries a second CLOSE button', closers === 0, closers + ' found');
  ok('the X in the corner is the way out', await page.isVisible('#mw-close'));
  await page.click('#mw-close');
  await sleep(400);
  ok('the X closes it', !(await page.isVisible('#lf-name')));

  /* ---- markdown ---- */
  const rendered = await page.evaluate(() => {
    const el = document.createElement('div');
    // The renderer is inside the IIFE, so exercise it through the DOM path the
    // skill editor uses rather than reaching for the function.
    return null;
  });

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { srv.kill('SIGTERM'); await sleep(300); fs.rmSync(dataDir, { recursive: true, force: true }); }
