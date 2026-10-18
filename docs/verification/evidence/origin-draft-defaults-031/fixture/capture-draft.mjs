import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from '../node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.mjs';
const out='docs/verification/evidence/origin-draft-defaults-031'; mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Users/aless/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true});
const contexts=[]; const rows=[]; const external=[];
try {
  for(const version of ['before','after']) for(const viewport of [{width:1280,height:900},{width:375,height:812}]) for(const theme of ['light','dark']) for(const scenario of ['board-reordered','board-renamed','composer-missing','feedback-reordered']) {
    const context=await browser.newContext({viewport,reducedMotion:'reduce'}); contexts.push(context);
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1') return route.continue(); external.push(u.origin);return route.abort();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const origin=version==='before'?'http://127.0.0.1:5175':'http://127.0.0.1:5177';
    const columns=scenario.endsWith('missing')?'missing':scenario.endsWith('renamed')?'renamed':'reordered';
    const screen=scenario.startsWith('feedback')?'feedback':'issues';
    const url=`${origin}/__origin-draft.html?screen=${screen}&columns=${columns}&theme=${theme}`;
    await page.goto(url,{waitUntil:'networkidle',timeout:60000});
    await page.getByRole('button',{name:'Switch project'}).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    if(scenario.startsWith('composer')) {await page.getByRole('button',{name:'New issue',exact:true}).click(); await page.getByRole('dialog').waitFor();}
    if(scenario.startsWith('feedback')) {await page.getByRole('button',{name:'Convert to issue',exact:true}).click();await page.getByRole('dialog').waitFor();}
    const state=await page.evaluate(()=>({
      lanes:[...document.querySelectorAll('[data-column-id]')].map(n=>n.dataset.columnId),
      status:document.querySelector('button[title="Status"]')?.getAttribute('aria-label')??document.querySelector('select')?.selectedOptions[0]?.textContent,
      overflow:document.documentElement.scrollWidth>innerWidth,
      calls:window.originPagesFixture.calls,
    }));
    const expected=scenario==='board-renamed'?'fixture-draft':'fixture-draft';
    if(version==='after' && scenario.startsWith('board')) assert.equal(state.lanes[0],expected);
    if(scenario==='composer-missing') assert.equal(state.status,version==='after'?'Status: Draft':'Status: Todo');
    if(scenario==='feedback-reordered') assert.equal(state.status,version==='after'?'Draft':'Todo');
    assert.equal(state.overflow,false); assert.deepEqual(errors,[]);
    const name=`${scenario}-${viewport.width}-${theme}-${version}.png`,path=`${out}/${name}`;
    await page.screenshot({path});
    const identity=await page.request.get(`${origin}/__origin-draft-fixture.json`).then(r=>r.json());
    rows.push({version,viewport,theme,scenario,url,identity,state,errors,screenshot:name,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
    console.log(JSON.stringify({version,width:viewport.width,theme,scenario,state}));
    await context.close();contexts.pop();
  }
  assert.equal(rows.length,32); assert.deepEqual(external,[]);
  writeFileSync(`${out}/report.json`,JSON.stringify({synthetic:true,baseline:'0757f71888d2c5aaf41bd877724949a63d815aa2',browser:await browser.version(),externalRequests:external,rows},null,2)+'\n');
} finally { for(const c of contexts) await c.close();await browser.close(); }
