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

  /* Every selected control has to be readable, in every theme.

     `.sel` was doing two jobs — "this is a dropdown" and "this is the chosen
     one" — and the workstation theme styled dropdowns with the sunk
     background. Selected options came out as near-black text on near-black,
     in every widget menu in the app, and nothing failed. Contrast is the
     assertion because "it looks fine" is what missed it. */
  const contrastSweep = () => page.evaluate(() => {
    const lum = c => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // The nearest ancestor that actually paints something.
    const behind = el => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      }
      return 'rgb(255,255,255)';
    };
    const worst = [];
    for (const el of document.querySelectorAll('#ctx .ctxopt, #ctx .ctxcheck, #ctx .ctxnote')) {
      if (!el.textContent.trim() || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      const a = lum(cs.color), b = lum(behind(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      worst.push({ txt: el.textContent.trim().slice(0, 12), sel: el.classList.contains('sel'), ratio: +ratio.toFixed(2) });
    }
    return worst.sort((x, y) => x.ratio - y.ratio);
  });

  const looks = [
    ['workstation/parchment', () => NexusAppearance.setPalette('parchment')],
    ['workstation/evergreen', () => NexusAppearance.setPalette('evergreen')],
    ['workstation/midnight',  () => NexusAppearance.setPalette('midnight')],
    ['classic/dark',  () => { NexusAppearance.setClassic(true); if (document.documentElement.dataset.theme !== 'dark') NexusAppearance.toggleClassicMode(); }],
    ['classic/light', () => { NexusAppearance.setClassic(true); if (document.documentElement.dataset.theme !== 'light') NexusAppearance.toggleClassicMode(); }]
  ];
  for (const [name, set] of looks) {
    await page.evaluate(`(${set.toString()})()`);
    await sleep(250);
    const bx = await (await page.$('#grid .w')).boundingBox();
    await page.mouse.click(bx.x + bx.width / 2, bx.y + 10, { button: 'right' });
    await sleep(350);
    const bad = (await contrastSweep()).filter(s => s.ratio < 4.5);
    ok(`every option in the widget menu is readable (${name})`, bad.length === 0,
       bad.map(b => `${b.txt}${b.sel ? ' [selected]' : ''} at ${b.ratio}:1`).join(', '));
    await page.keyboard.press('Escape'); await sleep(200);
  }
  await page.evaluate(() => NexusAppearance.setPalette('evergreen'));

  /* The Control Panel's controls: a switch that travels rather than jumping,
     a dropdown that is the page's own and not the browser's, and buttons far
     enough apart that CANCEL and SAVE are two targets. */
  await page.click('.nav[data-page="control"]'); await sleep(1600);
  const cp = await page.evaluate(() => {
    const t = document.querySelector('.toggle');
    const cs = t && getComputedStyle(t);
    const knob = t && getComputedStyle(t.querySelector('i'));
    const heads = [...document.querySelectorAll('#page-control .sechead')];
    return {
      toggles: document.querySelectorAll('.toggle').length,
      eased: !!cs && /cubic-bezier|ease/.test(knob.transitionTimingFunction) && !/steps/.test(knob.transitionTimingFunction),
      round: !!cs && parseFloat(cs.borderRadius) > 8,
      newRuleInToolbar: !!document.querySelector('#toolbar #cp-new-rule'),
      newRuleInSection: !!document.querySelector('#page-control .sechead #cp-new-rule'),
      sections: heads.length
    };
  });
  ok('the Control Panel sections carry their own actions',
     cp.newRuleInSection && !cp.newRuleInToolbar && cp.sections >= 4, JSON.stringify(cp));
  ok('the switch travels rather than stepping', cp.toggles > 0 && cp.eased, JSON.stringify(cp));
  ok('and it is a pill in the workstation theme', cp.round);

  await page.click('#cp-new-rule'); await sleep(1200);
  const form = await page.evaluate(() => {
    const sel = document.querySelector('#ru-src');
    const cs = getComputedStyle(sel);
    const foot = document.querySelector('.mw-foot');
    const btns = [...foot.querySelectorAll('.btn')].map(b => b.getBoundingClientRect());
    let gap = Infinity;
    for (let i = 1; i < btns.length; i++) gap = Math.min(gap, btns[i].left - btns[i - 1].right);
    return { appearance: cs.appearance, gap: btns.length > 1 ? Math.round(gap) : null,
             boxes: btns.map(b => [Math.round(b.left), Math.round(b.right)]) };
  });
  ok('the dropdown is the page\'s own control, not the browser\'s',
     form.appearance === 'none' || form.appearance === 'base-select', form.appearance);
  ok('footer buttons are far enough apart to be two targets', form.gap === null || form.gap >= 12, JSON.stringify(form));
  await page.click('#mw-close'); await sleep(400);

  /* The expert panel: it has to look like a panel, sit where you put it, and
     have its send button on the same line as the box it sends. */
  await page.click('.nav[data-page="dash"]'); await sleep(800);
  await page.click('#kernel-open'); await sleep(1200);
  const chat = await page.evaluate(() => {
    const panel = document.querySelector('#kernel');
    const cs = getComputedStyle(panel);
    const page_ = getComputedStyle(document.body);
    const ta = document.querySelector('#kx-input').getBoundingClientRect();
    const btn = document.querySelector('#kx-send').getBoundingClientRect();
    return {
      borderWidth: parseFloat(cs.borderTopWidth),
      borderColor: cs.borderTopColor,
      bodyBg: page_.backgroundColor,
      panelBg: cs.backgroundColor,
      shadow: cs.boxShadow !== 'none',
      bottomGap: Math.abs(ta.bottom - btn.bottom),
      heightGap: Math.abs(ta.height - btn.height)
    };
  });
  ok('the panel has an edge of its own, not the page\'s colour',
     chat.borderWidth >= 1 && chat.borderColor !== chat.panelBg &&
     chat.borderColor !== chat.bodyBg && chat.shadow, JSON.stringify(chat));
  ok('the box and SEND sit on the same line',
     chat.bottomGap < 2 && chat.heightGap < 2, `bottom off by ${chat.bottomGap}px, height by ${chat.heightGap}px`);

  // Dragged by its header, and it stays where it was put.
  const head = await page.$('#kx-head');
  const hb = await head.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 240, hb.y + hb.height / 2 - 120, { steps: 10 });
  await page.mouse.up();
  await sleep(500);
  const moved = await page.evaluate(() => {
    const r = document.querySelector('#kernel').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), saved: localStorage.getItem('nexus.kernel.geom') };
  });
  ok('the panel can be dragged anywhere on the page', moved.x < 900 && !!moved.saved, JSON.stringify(moved));

  // Resized from the edge that has room in front of it.
  const before2 = await page.evaluate(() => document.querySelector('#kernel').getBoundingClientRect().width);
  const grip = await page.$('.kx-grip.w');
  const gb = await grip.boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x - 160, gb.y + gb.height / 2, { steps: 10 });
  await page.mouse.up();
  await sleep(500);
  const after2 = await page.evaluate(() => document.querySelector('#kernel').getBoundingClientRect().width);
  ok('and resized from its edge', after2 > before2 + 100, `${Math.round(before2)} -> ${Math.round(after2)}`);

  // Tabs, and the + that starts a conversation.
  await page.click('#kx-add'); await sleep(900);
  ok('the + starts another conversation', (await page.$$('.kx-tab:not(.add)')).length >= 1);
  ok('the panel remembers it across a reload', await page.evaluate(() => !!localStorage.getItem('nexus.kernel.chat')));

  await page.click('#kx-reset'); await sleep(500);
  const home = await page.evaluate(() => {
    const r = document.querySelector('#kernel').getBoundingClientRect();
    return { right: Math.round(innerWidth - r.right), saved: localStorage.getItem('nexus.kernel.geom') };
  });
  ok('and it can be put back in the corner', home.right < 40 && home.saved === '{}', JSON.stringify(home));
  await page.click('#kx-close'); await sleep(300);

  /* The skill editor is a document editor, and it has twice been squashed to
     one line by a theme rule that outranks its own — the same specificity
     trap as the contrast bug above. Assert the height, not the rule. */
  await page.click('.nav[data-page="settings"]'); await sleep(1800);
  await page.click('#ag-skills-open'); await sleep(1500);
  await page.click('.sk-item >> text=OPEN'); await sleep(1200);
  const editor = await page.evaluate(() => {
    const ta = document.querySelector('#sk-e-body');
    const view = document.querySelector('#sk-e-view');
    return {
      taH: ta ? ta.getBoundingClientRect().height : 0,
      taHidden: ta?.hidden,
      viewHidden: view?.hidden,
      tabs: [...document.querySelectorAll('.sk-tab')].map(t => t.textContent.trim() + (t.classList.contains('on') ? '*' : '')),
      rendered: !!view?.querySelector('table, h2, strong')
    };
  });
  ok('the skill editor opens on the rendered view', editor.tabs.join(',') === 'PREVIEW*,WRITE', editor.tabs.join(','));
  ok('and what it renders is markdown, not the source', editor.rendered && !editor.viewHidden);
  await page.click('.sk-tab >> text=WRITE'); await sleep(400);
  const writeH = await page.evaluate(() => document.querySelector('#sk-e-body').getBoundingClientRect().height);
  ok('the text box is document-sized, not one line', writeH > 300, writeH + 'px');
  await page.click('#mw-close'); await sleep(400);

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally {
  srv.kill('SIGTERM'); await sleep(300);
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(share, { recursive: true, force: true });
}
