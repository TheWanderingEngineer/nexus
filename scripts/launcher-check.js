/* Apps page check — `npm run apps:check`.
 *
 * The board is links, an order and a few flags, so the things worth asserting
 * are: what the server refuses to store, that PULL ALL never touches what is
 * already there, that a PIN actually withholds the address rather than hiding
 * a button, that an old x/y board is read rather than lost, and that the
 * close-button rule still holds.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-lp-'));
const conf = path.join(dataDir, 'config.json');
fs.writeFileSync(conf, JSON.stringify({ terminal: { enabled: false } }));

/* A board written by the previous version: positions, no sizes. It goes in
   before the server starts, because migration happens on read. */
fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
  users: [], sessions: [], audit: [],
  settings: { launcher: [
    { id: 'old2', name: 'Second', url: 'http://10.0.0.2:81', ports: [81], x: 0, y: 4, w: 4, h: 2 },
    { id: 'old1', name: 'First',  url: 'http://10.0.0.1:80', ports: [80], x: 2, y: 0, w: 2, h: 1 }
  ] }
}));

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

  /* ---- an old board is read, not lost ---- */
  const legacy = (await A('/launcher')).body.apps;
  ok('an x/y board is read as an ordered list',
     legacy.map(a => a.name).join(',') === 'First,Second', legacy.map(a => a.name).join(','));
  ok('and its widths become sizes', legacy[0].size === 'm' && legacy[1].size === 'xl',
     legacy.map(a => a.size).join(','));

  /* ---- what the server refuses ---- */
  const bad = await A('/launcher', { method: 'PUT', body: JSON.stringify({
    apps: [
      { id: 'x1', name: 'Evil', url: 'javascript:alert(1)', externalUrl: 'data:text/html,<script>1</script>' },
      { id: 'x2', name: 'Fine', url: 'http://192.168.1.50:8096', size: 'enormous',
        tags: ['MEDIA!', 'watch', 'a', 'b', 'c', 'd', 'e', 'f'] }
    ],
    groups: [{ id: 'g1', name: 'Watching', color: 'amber' }, { id: 'g2', name: 'Boxes', color: 'not-a-colour' }]
  }) });
  ok('a javascript: address is refused', bad.body.apps[0].url === '' && bad.body.apps[0].externalUrl === '',
     JSON.stringify([bad.body.apps[0].url, bad.body.apps[0].externalUrl]));
  ok('an http address survives', bad.body.apps[1].url === 'http://192.168.1.50:8096/');
  ok('an unknown size falls back rather than reaching the stylesheet', bad.body.apps[1].size === 'm', bad.body.apps[1].size);
  ok('tags are cleaned and capped at six',
     bad.body.apps[1].tags.length === 6 && bad.body.apps[1].tags[0] === 'media', JSON.stringify(bad.body.apps[1].tags));
  ok('a made-up group colour falls back', bad.body.groups[1].color === 'cyan', bad.body.groups[1].color);

  /* ---- the PIN withholds the address, not just the button ---- */
  await A('/launcher/x2/lock', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
  const hidden = (await A('/launcher')).body.apps.find(a => a.id === 'x2');
  ok('a locked app reports that it is locked', hidden.locked === true);
  ok('and its address never reaches the browser', hidden.url === '' && hidden.externalUrl === '',
     JSON.stringify([hidden.url, hidden.externalUrl]));
  ok('the PIN itself is not in the response', !JSON.stringify(hidden).includes('2468') && !('lock' in hidden));

  const wrong = await A('/launcher/x2/open', { method: 'POST', body: JSON.stringify({ pin: '1111' }) });
  ok('the wrong PIN is refused', wrong.status === 403, String(wrong.status));
  const right = await A('/launcher/x2/open', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
  ok('the right PIN hands over the address', right.body.url === 'http://192.168.1.50:8096/', JSON.stringify(right.body));

  // An ordinary board save cannot see the address or the PIN, so it must not
  // be able to wipe either of them.
  await A('/launcher', { method: 'PUT', body: JSON.stringify({
    apps: (await A('/launcher')).body.apps, groups: [] }) });
  const after = await A('/launcher/x2/open', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
  ok('saving the board does not unlock or blank it',
     after.body.url === 'http://192.168.1.50:8096/' &&
     (await A('/launcher')).body.apps.find(a => a.id === 'x2').locked === true, JSON.stringify(after.body));

  for (let i = 0; i < 6; i++) await A('/launcher/x2/open', { method: 'POST', body: JSON.stringify({ pin: '0000' }) });
  const flood = await A('/launcher/x2/open', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
  ok('guessing is throttled', flood.status === 429, String(flood.status));

  await A('/launcher/x2/lock', { method: 'DELETE' });
  const unlocked = (await A('/launcher')).body.apps.find(a => a.id === 'x2');
  ok('taking the PIN off brings the address back',
     unlocked.locked === false && unlocked.url === 'http://192.168.1.50:8096/', JSON.stringify(unlocked));

  const disc = await A('/launcher/discover');
  ok('discover reports Docker honestly when it is absent',
     disc.body.available === false && typeof disc.body.reason === 'string', JSON.stringify(disc.body).slice(0, 80));

  /* ---- the board the browser draws ---- */
  await A('/launcher', { method: 'PUT', body: JSON.stringify({
    groups: [{ id: 'g1', name: 'Watching', color: 'amber' }],
    apps: [
      { id: 'a1', name: 'Jellyfin', url: 'http://10.0.0.5:8096', ports: [8096], tags: ['media'], group: 'g1', size: 'm' },
      { id: 'a2', name: 'Sonarr', url: 'http://10.0.0.5:8989', ports: [8989], tags: ['media', 'grabbing'], group: 'g1', size: 's' },
      { id: 'a3', name: 'Portainer', url: 'http://10.0.0.5:9000', ports: [9000], tags: ['boxes'], size: 'm' }
    ] }) });

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

  await page.click('.nav[data-page="apps"]');
  await sleep(1200);
  ok('every app renders as a tile', (await page.$$('.ltile')).length === 3);
  ok('a group becomes a titled band',
     (await page.$$eval('.lsechead b', e => e.map(x => x.textContent))).includes('Watching'));
  ok('nothing pinned means no divider above the board', (await page.$$('.lsec.pinned')).length === 0);
  ok('the toolbar offers add, group and pull',
     await page.isVisible('#l-add') && await page.isVisible('#l-group') && await page.isVisible('#l-pull'));

  /* ---- tags ---- */
  ok('every tag in use becomes a filter chip', (await page.$$('.ltagchip')).length === 3);
  await page.click('.ltagchip[data-tagf="boxes"]');
  await sleep(500);
  ok('a tag chip filters the board', (await page.$$('.ltile')).length === 1);
  await page.click('.ltagchip[data-tagf="boxes"]');
  await sleep(500);
  ok('and clicking it again clears the filter', (await page.$$('.ltile')).length === 3);

  /* ---- pinning ---- */
  await page.click('.ltile[data-id="a3"] [data-edit]');
  await page.waitForSelector('#lf-pin', { timeout: 8000 });
  await page.check('#lf-pin');
  await page.click('#lf-save');
  await sleep(1400);
  ok('a pinned app moves into its own band above a rule',
     (await page.$$('.lsec.pinned .ltile[data-id="a3"]')).length === 1 &&
     (await page.$$('.lsec.pinned')).length === 1);
  ok('and the pin is persisted', (await A('/launcher')).body.apps.find(a => a.id === 'a3').pinned === true);

  /* ---- selecting ---- */
  await page.click('.ltile[data-id="a1"]', { modifiers: ['Control'] });
  await sleep(300);
  await page.click('.ltile[data-id="a2"]', { modifiers: ['Control'] });
  await sleep(300);
  ok('ctrl-click builds a selection', await page.isVisible('#l-selbar') &&
     (await page.textContent('#l-selcount')).startsWith('2'), await page.textContent('#l-selcount'));
  await page.click('#l-selclear');
  await sleep(300);
  ok('CLEAR puts the bar away', !(await page.isVisible('#l-selbar')));

  /* ---- dragging reorders, and the order is what is stored ---- */
  const before = (await A('/launcher')).body.apps.map(a => a.id).join(',');
  const from = await page.$('.ltile[data-id="a1"]'), to = await page.$('.ltile[data-id="a2"]');
  const fb = await from.boundingBox(), tb = await to.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width - 6, tb.y + tb.height / 2, { steps: 12 });
  await page.mouse.up();
  await sleep(1400);
  const afterOrder = (await A('/launcher')).body.apps.map(a => a.id).join(',');
  ok('dragging one tile past another reorders the board', afterOrder !== before, `${before} -> ${afterOrder}`);

  /* ---- only one way out of a window ---- */
  await page.click('.ltile[data-id="a1"] [data-edit]');
  await page.waitForSelector('#lf-name', { timeout: 8000 });
  const closers = await page.$$eval('#modal button', els =>
    els.filter(e => /^close$/i.test(e.textContent.trim())).length);
  ok('no window carries a second CLOSE button', closers === 0, closers + ' found');
  ok('the X in the corner is the way out', await page.isVisible('#mw-close'));
  await page.click('#mw-close');
  await sleep(400);
  ok('the X closes it', !(await page.isVisible('#lf-name')));

  /* ---- a phone ----
     The board has to arrive intact on the small screen: same tiles, same
     order, nothing hanging off the side. */
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(900);
  const phone = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.ltile')];
    const doc = document.documentElement;
    return {
      n: tiles.length,
      order: tiles.map(t => t.dataset.id).join(','),
      overflow: tiles.filter(t => t.getBoundingClientRect().right > innerWidth + 1).length,
      sideScroll: doc.scrollWidth > doc.clientWidth + 1
    };
  });
  const deskOrder = (await A('/launcher')).body.apps
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map(a => a.id);
  ok('the phone shows every tile', phone.n === 3, String(phone.n));
  ok('nothing hangs off the side of a phone', phone.overflow === 0 && !phone.sideScroll, JSON.stringify(phone));
  ok('the arrangement arrives in the same order', phone.order === deskOrder.join(','),
     `${phone.order} vs ${deskOrder.join(',')}`);

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { srv.kill('SIGTERM'); await sleep(300); fs.rmSync(dataDir, { recursive: true, force: true }); }
