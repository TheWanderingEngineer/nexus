/* Reverse-proxy check — `npm run proxy:check`.
 *
 * Nexus behind a DuckDNS name and Nginx Proxy Manager is the common way to
 * reach it from outside, and it is where the live dashboard quietly stops
 * working: nginx does not forward a WebSocket upgrade unless it is told to,
 * and NPM ships that switch off. This drives a real browser through four
 * proxy shapes and asserts the dashboard keeps working and says what is wrong.
 *
 * Reproduces "reached over DuckDNS + reverse proxy" four ways:
     A. proxy that forwards Upgrade  (NPM with Websockets Support ON)
     B. proxy that does NOT          (NPM default — the toggle is off)
     C. proxy that rewrites Host to the upstream, with trustedProxies unset
     D. the same, once trustedProxies names it
   and asserts what the dashboard actually shows in each. */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-px-'));
const conf=path.join(dataDir,'config.json');
fs.writeFileSync(conf,JSON.stringify({terminal:{enabled:true}}));
const APP=8801;
const srv=spawn(process.execPath,[path.join(ROOT,'server/index.js')],{cwd:ROOT,
  env:{...process.env,NEXUS_PORT:String(APP),NEXUS_HOST:'127.0.0.1',NEXUS_DATA_DIR:dataDir,NEXUS_CONFIG:conf},
  stdio:['ignore','pipe','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv!] '+d));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/** A minimal reverse proxy. `ws` decides whether upgrades are relayed at all;
 *  `hostMode` decides what Host header the upstream sees. */
function proxy(port, { ws, hostMode }) {
  const hostHeader = req => hostMode === 'upstream' ? `127.0.0.1:${APP}` : req.headers.host;
  const s = http.createServer((req, res) => {
    const headers = { ...req.headers, host: hostHeader(req),
      'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https',
      'x-forwarded-host': req.headers.host };
    const up = http.request({ host:'127.0.0.1', port:APP, path:req.url, method:req.method, headers }, r => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', e => { res.writeHead(502); res.end('proxy: '+e.message); });
    req.pipe(up);
  });
  if (ws) {
    s.on('upgrade', (req, sock, head) => {
      const headers = { ...req.headers, host: hostHeader(req),
        'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https',
        'x-forwarded-host': req.headers.host };
      const up = http.request({ host:'127.0.0.1', port:APP, path:req.url, method:'GET', headers });
      up.on('upgrade', (r, usock, uhead) => {
        sock.write('HTTP/1.1 101 Switching Protocols\r\n' +
          Object.entries(r.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n') + '\r\n\r\n');
        if (uhead?.length) sock.write(uhead);
        usock.pipe(sock); sock.pipe(usock);
      });
      up.on('response', r => { sock.end(`HTTP/1.1 ${r.statusCode} x\r\n\r\n`); });
      up.on('error', () => sock.destroy());
      up.end();
    });
  }
  // With ws:false the server simply has no 'upgrade' listener, so Node answers
  // the handshake itself and closes — exactly what nginx does without the
  // Upgrade/Connection headers set.
  return new Promise(r => s.listen(port, '127.0.0.1', () => r(s)));
}

let pass=0,fail=0;
const ok=(n,c,x='')=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n+(x?' — '+x:'')));};

async function probe(label, port) {
  console.log(`\n== ${label} (http://127.0.0.1:${port}) ==`);
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx=await browser.newContext({viewport:{width:1400,height:900}});
  const page=await ctx.newPage();
  const wsFails=[];
  page.on('websocket', w => { w.on('socketerror', e => wsFails.push(String(e))); });
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
  // log in through the form so the whole cookie path goes via the proxy
  if (await page.isVisible('#g-user')) {
    await page.fill('#g-user','px'); await page.fill('#g-pass','px-password-1234');
    if (await page.isVisible('#g-confirm')) await page.fill('#g-confirm','px-password-1234');
    await page.click('#g-submit');
    await page.waitForSelector('#app:not([hidden])',{timeout:15000});
  }
  await sleep(12000);
  const state = await page.evaluate(() => ({
    live: document.querySelector('#st-state')?.textContent?.trim(),
    cpu: document.querySelector('#tb-cpu')?.textContent,
    mem: document.querySelector('#tb-mem')?.textContent,
    banner: document.querySelector('#wsbanner .wsb-body b')?.textContent?.trim() || null,
    bannerBody: document.querySelector('#wsbanner .wsb-body div')?.textContent?.trim() || null
  }));
  console.log('   topbar:', JSON.stringify(state));
  await browser.close();
  return state;
}

try{
  for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${APP}/api/health`)).ok)break;}catch{} await sleep(500);}
  await fetch(`http://127.0.0.1:${APP}/api/setup`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'px',password:'px-password-1234'})});

  const a=await proxy(8811,{ws:true,  hostMode:'keep'});
  const b=await proxy(8812,{ws:false, hostMode:'keep'});
  const c=await proxy(8813,{ws:true,  hostMode:'upstream'});

  const A=await probe('A: proxy WITH websocket support', 8811);
  ok('A shows LIVE', A.live==='LIVE', A.live);
  ok('A shows real CPU', A.cpu && A.cpu!=='--' && A.cpu!=='0%', A.cpu);

  const B=await probe('B: proxy WITHOUT websocket support (NPM default)', 8812);
  ok('B still shows real readings, by polling', B.cpu && B.cpu!=='--' && B.cpu!=='0%', B.cpu);
  ok('B tells the user why the socket is gone', !!B.banner, 'no explanation shown anywhere');

  const B2=await probe('B (repeat): does the banner name the right cause?', 8812);
  ok('B names the proxy, not the origin check',
     /not forwarding WebSockets/.test(B2.banner||''), B2.banner);
  ok('B keeps showing real numbers by polling', B2.cpu && B2.cpu!=='--', B2.cpu);
  ok('B says POLLING, not LIVE', B2.live==='POLLING', B2.live);

  const C=await probe('C: Host rewritten, trustedProxies EMPTY', 8813);
  ok('C is refused and says so', /origin check/.test(C.banner||''), C.banner);
  ok('C hands over the exact config to paste', /allowedOrigins/.test(C.bannerBody||''), (C.bannerBody||'').slice(0,80));
  ok('C still shows real numbers', C.cpu && C.cpu!=='--', C.cpu);

  // Now tell Nexus the proxy is trusted, which is the documented fix, and the
  // same setup must come up LIVE.
  fs.writeFileSync(conf, JSON.stringify({terminal:{enabled:true}, trustedProxies:['127.0.0.1']}));
  srv.kill('SIGTERM'); await sleep(800);
  const srv2=spawn(process.execPath,[path.join(ROOT,'server/index.js')],{cwd:ROOT,
    env:{...process.env,NEXUS_PORT:String(APP),NEXUS_HOST:'127.0.0.1',NEXUS_DATA_DIR:dataDir,NEXUS_CONFIG:conf},
    stdio:['ignore','pipe','pipe']});
  srv2.stderr.on('data',d=>process.stderr.write('[srv2!] '+d));
  for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${APP}/api/health`)).ok)break;}catch{} await sleep(500);}
  const D=await probe('D: same Host rewrite, trustedProxies set', 8813);
  ok('D comes up LIVE once the proxy is trusted', D.live==='LIVE', D.live);
  ok('D has no banner', !D.banner, D.banner);
  srv2.kill('SIGTERM');

  a.close(); b.close(); c.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally { srv.kill('SIGTERM'); await sleep(300); fs.rmSync(dataDir,{recursive:true,force:true}); }
