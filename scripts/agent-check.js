/* Nexus Expert engine check — `npm run agent:check`.
   Drives the whole agent loop against a stub provider we control, so the tool
   calling, the approval gate, the path jail and the token accounting are all
   exercised for real without spending anyone's money. */
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';

import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-loop-'));
const share=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-loopshare-'));
fs.writeFileSync(path.join(share,'readme.txt'),'the secret is 42\n');
const outside=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-outside-'));
fs.writeFileSync(path.join(outside,'private.txt'),'do not read me\n');
const conf=path.join(dataDir,'config.json');
fs.writeFileSync(conf, JSON.stringify({ fileRoots:[{name:'SHARE',path:share}], terminal:{enabled:false} }));

let pass=0,fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('PASS '+n);} else {fail++;console.log('FAIL '+n+(x?' — '+x:''));} };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---- the stub provider: a scripted OpenAI-compatible endpoint ---- */
let script=[], seen=[];
const stub=http.createServer((req,res)=>{
  let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
    const body=JSON.parse(b); seen.push(body);
    const next=script.shift() || { content:'done' };
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({
      choices:[{ message:{ role:'assistant', content:next.content ?? null,
        ...(next.tool ? { tool_calls:[{ id:'c1', type:'function',
          function:{ name:next.tool, arguments:JSON.stringify(next.args||{}) } }] } : {}) },
        finish_reason: next.tool ? 'tool_calls' : 'stop' }],
      usage:{ prompt_tokens: next.in ?? 100, completion_tokens: next.out ?? 20 }
    }));
  });
});
await new Promise(r=>stub.listen(8791,'127.0.0.1',r));

const PORT=8792, base=`http://127.0.0.1:${PORT}`;
const srv=spawn(process.execPath,[path.join(ROOT,'server/index.js')],{cwd:ROOT,
  env:{...process.env,NEXUS_PORT:String(PORT),NEXUS_HOST:'127.0.0.1',NEXUS_DATA_DIR:dataDir,
       NEXUS_CONFIG:conf,NEXUS_TERMINAL:'off'},stdio:['ignore','pipe','pipe']});
srv.stderr.on('data',d=>process.stderr.write('[srv!] '+d));

try{
  for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{} await sleep(500);}
  const s=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'lp',password:'lp-password-1234'})});
  const setup=await s.json();
  const cookie=(s.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');
  const A=async(p,o={})=>{
    const r=await fetch(base+'/api'+p,{...o,headers:{'Content-Type':'application/json','Cookie':cookie,'X-CSRF-Token':setup.csrf}});
    return { status:r.status, body: await r.json() };
  };

  await A('/agent/config',{method:'PUT',body:JSON.stringify({
    provider:'custom', model:'stub-model', customModel:'stub-model',
    baseUrl:'http://127.0.0.1:8791',
    roots:[share], approval:'ask',
    caps:{ metrics:true, readFiles:true, writeFiles:true, shell:true, docker:false }
  })});

  /* 1. A read tool runs without asking, and the answer comes back. */
  script=[ { tool:'read_file', args:{ path: path.join(share,'readme.txt') } },
           { content:'The file says the secret is 42.' } ];
  let run=(await A('/agent/run',{method:'POST'})).body;
  let t=(await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'what is in readme.txt'})})).body;
  ok('a read tool runs without asking', t.steps.some(x=>x.kind==='tool'&&x.name==='read_file'&&!x.error));
  ok('the file contents reach the model', JSON.stringify(seen).includes('the secret is 42'));
  ok('the final answer comes back', t.steps.some(x=>x.kind==='assistant'&&x.text.includes('42')));
  ok('nothing is left pending', !t.pending);
  ok('tokens are counted', t.usage.in===200 && t.usage.out===40, JSON.stringify(t.usage));

  /* 2. The path jail refuses a read outside the shared folder. */
  script=[ { tool:'read_file', args:{ path: path.join(outside,'private.txt') } },
           { content:'I could not read that.' } ];
  run=(await A('/agent/run',{method:'POST'})).body;
  t=(await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'read the private file'})})).body;
  const jail=t.steps.find(x=>x.kind==='tool'&&x.name==='read_file');
  ok('a path outside the shared folder is refused', jail?.error===true, JSON.stringify(jail?.result));
  ok('the refused contents never reached the model', !JSON.stringify(seen).includes('do not read me'));

  /* 3. A write pauses for approval; denying it stops the write happening. */
  const target=path.join(share,'created.txt');
  script=[ { tool:'write_file', args:{ path:target, content:'written by hermes' } },
           { content:'Understood, I will leave it alone.' } ];
  run=(await A('/agent/run',{method:'POST'})).body;
  t=(await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'make a file'})})).body;
  ok('a write pauses for approval', !!t.pending && t.pending.name==='write_file');
  ok('the approval shows what will happen', (t.pending?.preview||'').includes('written by hermes'));
  ok('nothing is written while it waits', !fs.existsSync(target));
  t=(await A(`/agent/run/${run.id}/approve`,{method:'POST',body:JSON.stringify({decision:'deny'})})).body;
  ok('denying leaves the file alone', !fs.existsSync(target));
  ok('the denial is recorded in the transcript', t.steps.some(x=>x.denied));

  /* 4. Approving it performs the write. */
  script=[ { tool:'write_file', args:{ path:target, content:'written by hermes' } },
           { content:'Done.' } ];
  run=(await A('/agent/run',{method:'POST'})).body;
  t=(await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'make it for real'})})).body;
  t=(await A(`/agent/run/${run.id}/approve`,{method:'POST',body:JSON.stringify({decision:'allow'})})).body;
  ok('approving performs the write', fs.existsSync(target) && fs.readFileSync(target,'utf8')==='written by hermes');

  /* 5. Full access runs a real command with no gate. */
  await A('/agent/config',{method:'PUT',body:JSON.stringify({approval:'auto'})});
  script=[ { tool:'run_command', args:{ command:'echo hermes-was-here' } }, { content:'It printed it.' } ];
  run=(await A('/agent/run',{method:'POST'})).body;
  t=(await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'run echo'})})).body;
  const cmd=t.steps.find(x=>x.kind==='tool'&&x.name==='run_command');
  ok('full access runs a command with no gate', !t.pending && cmd && cmd.result.includes('hermes-was-here'), JSON.stringify(cmd?.result));

  /* 6. Turning the capability off makes the tool disappear entirely. */
  await A('/agent/config',{method:'PUT',body:JSON.stringify({caps:{metrics:true,readFiles:true,writeFiles:true,shell:false,docker:false}})});
  seen=[];
  script=[ { content:'I cannot run commands.' } ];
  run=(await A('/agent/run',{method:'POST'})).body;
  await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'run something'})});
  const offered=(seen[0]?.tools||[]).map(x=>x.function.name);
  ok('a switched-off capability is not even offered to the model', !offered.includes('run_command'), offered.join(','));

  /* 7. The step cap stops a runaway loop. */
  await A('/agent/config',{method:'PUT',body:JSON.stringify({maxSteps:3})});
  script=Array.from({length:10},()=>({ tool:'system_metrics', args:{} }));
  run=(await A('/agent/run',{method:'POST'})).body;
  t=(await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'loop forever'})})).body;
  ok('the step cap stops a runaway loop', t.steps.filter(x=>x.kind==='tool').length===3 && t.steps.some(x=>x.kind==='error'),
     t.steps.filter(x=>x.kind==='tool').length+' tool calls');

  /* 8. Usage accumulates across runs and survives a reset. */
  const usage=(await A('/agent/config')).body.usage;
  ok('usage accumulates across conversations', usage.inTokens>0 && usage.outTokens>0 && usage.runs>=6, JSON.stringify(usage));
  await A('/agent/usage',{method:'DELETE'});
  ok('resetting clears the counters', (await A('/agent/config')).body.usage.inTokens===0);

  /* The collector starts a moment after the socket opens (deliberately — see
     index.js), so wait for a real sample before asserting on live readings. */
  for (let i=0;i<60;i++){
    const m=(await A('/system/metrics')).body;
    if (m.updatedAt && m.mem?.total) break;
    await sleep(500);
  }

  /* 9. Skills: the library seeds itself, memory vs on-demand behave differently. */
  const sk0 = (await A('/agent/skills')).body;
  ok('the starter library is seeded on first boot', sk0.list.length >= 8, sk0.list.length + ' skills');
  ok('some skills are memory and some are on demand',
     sk0.list.some(k => k.mode === 'always') && sk0.list.some(k => k.mode === 'ondemand'));
  ok('the memory budget is reported', sk0.budget.limit > 0 && sk0.budget.used > 0 && !sk0.budget.over,
     JSON.stringify(sk0.budget));

  await A('/agent/config',{method:'PUT',body:JSON.stringify({approval:'auto',maxSteps:12})});
  seen=[];
  script=[{content:'noted'}];
  run=(await A('/agent/run',{method:'POST'})).body;
  await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'hi'})});
  const sys = seen[0].messages.find(m => m.role === 'system').content;
  ok('always-on skills are in the system prompt', sys.includes('Who you are') && sys.includes('Nexus itself'));
  ok('on-demand skill bodies are NOT in the system prompt', !sys.includes('Prowlarr holds the indexers'));
  ok('on-demand skills are advertised by name', sys.includes('media-stack'));
  ok('load_skill is offered as a tool', (seen[0].tools||[]).some(t => t.function.name === 'load_skill'));

  /* The live briefing: the agent should know where it is without a tool call. */
  ok('the briefing names the host', /Host: /.test(sys));
  ok('the briefing carries live CPU and memory',
     /CPU: \d/.test(sys) && /Memory: [\d.]+ (MB|GB) of /.test(sys), sys.split('\n').filter(l=>/^(CPU|Memory):/.test(l)).join(' | '));
  ok('the briefing lists the filesystems', /Filesystems:/.test(sys));
  ok('an unmeasurable reading says so rather than going quiet',
     /(Disk I\/O)/.test(sys), 'no disk I/O line at all');
  ok('the briefing lists the shared folder', sys.includes(share));
  ok('the briefing is stamped as a snapshot', /Right now \(measured/.test(sys));

  /* Pulling one on demand returns its body. */
  seen=[];
  script=[{tool:'load_skill',args:{name:'media-stack'}},{content:'Read it.'}];
  run=(await A('/agent/run',{method:'POST'})).body;
  t=(await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'how does sonarr import work'})})).body;
  ok('load_skill returns the skill body', JSON.stringify(seen).includes('Prowlarr holds the indexers'));

  /* Adding, switching off, and deleting. */
  let skr=(await A('/agent/skills',{method:'POST',body:JSON.stringify({
    name:'my notes', content:'---\nname: My Notes\ndescription: personal\nmode: always\n---\n\nThe NAS password hint is on the fridge.'})})).body;
  ok('a dropped markdown file becomes a skill', skr.list.some(k=>k.id==='my-notes' && k.mode==='always'));

  seen=[]; script=[{content:'ok'}];
  run=(await A('/agent/run',{method:'POST'})).body;
  await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'hi'})});
  ok('a new memory skill reaches the prompt immediately',
     seen[0].messages.find(m=>m.role==='system').content.includes('on the fridge'));

  await A('/agent/skills/my-notes',{method:'PUT',body:JSON.stringify({enabled:false})});
  seen=[]; script=[{content:'ok'}];
  run=(await A('/agent/run',{method:'POST'})).body;
  await A(`/agent/run/${run.id}/send`,{method:'POST',body:JSON.stringify({text:'hi'})});
  ok('switching a skill off removes it from the prompt',
     !seen[0].messages.find(m=>m.role==='system').content.includes('on the fridge'));

  /* A filename cannot address anything outside the skills folder. */
  const esc0=(await A('/agent/skills',{method:'POST',body:JSON.stringify({
    name:'../../../../etc/cron.d/pwned', content:'x'})})).body;
  ok('a traversing filename is flattened, not honoured',
     !esc0.id.includes('/') && !esc0.id.includes('..') && !fs.existsSync('/etc/cron.d/pwned'), esc0.id);
  await A('/agent/skills/'+encodeURIComponent(esc0.id),{method:'DELETE'});

  const del=(await A('/agent/skills/media-stack',{method:'DELETE'})).body;
  ok('a skill can be deleted permanently', !del.list.some(k=>k.id==='media-stack'));
  const rest=(await A('/agent/skills/restore',{method:'POST'})).body;
  ok('restore defaults brings a stock skill back', rest.added===1 && rest.list.some(k=>k.id==='media-stack'));

  /* 10. The key test reports a real failure rather than pretending. */
  const test=(await A('/agent/test',{method:'POST'})).body;
  ok('the key test round-trips against the provider', test.ok===true && typeof test.ms==='number', JSON.stringify(test));

  /* 11. Every tool call is in the audit log. */
  const audit=(await A('/audit?limit=200')).body;
  ok('every tool call is audited', audit.filter(e=>e.action==='agent.tool').length>=5);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail?1:0;
} finally {
  srv.kill('SIGTERM'); stub.close(); await sleep(300);
  for (const d of [dataDir, share, outside]) fs.rmSync(d,{recursive:true,force:true});
}
