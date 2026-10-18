import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.mjs';
const out='docs/verification/evidence/origin-draft-mirror-031';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Users/aless/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true});const rows=[];const external=[];
try {
 for(const version of ['before','after'])for(const width of [375,1280])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  try{
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1')return route.continue();external.push(url.origin);return route.abort();});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const origin=version==='before'?'http://127.0.0.1:5175':'http://127.0.0.1:5177';
   await page.goto(`${origin}/__origin-draft.html?screen=issues&columns=legacy&theme=${theme}`,{waitUntil:'networkidle',timeout:60000});await page.getByText('Legacy private idea',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
   const state=await page.evaluate(()=>({githubCalls:window.originPagesFixture.githubCalls,calls:window.originPagesFixture.calls,lanes:[...document.querySelectorAll('[data-column-id]')].map(n=>n.dataset.columnId),overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.deepEqual(state.githubCalls,[{projectId:'fixture-project',taskIds:version==='before'?['task-fixture-idea','task-fixture-todo']:['task-fixture-todo']}]);
   assert.deepEqual(state.lanes,['fixture-idea','fixture-todo']);assert.equal(state.overflow,false);assert.deepEqual(errors,[]);
   const screenshot=`legacy-mirror-${width}-${theme}-${version}.png`;await page.screenshot({path:`${out}/${screenshot}`});
   const identity=await page.request.get(`${origin}/__origin-draft-fixture.json`).then(r=>r.json());rows.push({version,width,theme,state,identity,errors,screenshot,sha256:createHash('sha256').update(readFileSync(`${out}/${screenshot}`)).digest('hex')});console.log(JSON.stringify({version,width,theme,state}));
  }finally{await context.close();}
 }
 assert.equal(rows.length,8);assert.deepEqual(external,[]);writeFileSync(`${out}/report.json`,JSON.stringify({synthetic:true,baseline:'6d31c2e5278042d0bf3ef25fe3f1fb501ba9822d',browser:await browser.version(),externalRequests:external,rows,qualification:'Cloud repair and GitHub mirror are in-memory fixture facades. Requests are recorded, never sent to GitHub. Source-only effect guard; screenshots intentionally retain the same repaired board appearance.'},null,2)+'\n');
}finally{await browser.close();}
