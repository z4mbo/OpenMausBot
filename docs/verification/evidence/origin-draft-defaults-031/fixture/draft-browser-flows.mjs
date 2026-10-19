import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from '../node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.mjs';
const browser=await chromium.launch({executablePath:'C:/Users/aless/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true});
const rows=[];
try {
  for(const width of [375,1280]) for(const reducedMotion of ['no-preference','reduce']) for(const scenario of ['default','lane','status','feedback-default','feedback-explicit']) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion});
    try {
      await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
      const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const feedback=scenario.startsWith('feedback');
      await page.goto(`http://127.0.0.1:5177/__origin-draft.html?screen=${feedback?'feedback':'issues'}&columns=renamed&theme=dark`,{waitUntil:'networkidle',timeout:60000});
      if(feedback) {
        await page.getByRole('button',{name:'Convert to issue',exact:true}).click();
        const selects=page.getByRole('dialog').locator('select');
        assert.equal(await selects.nth(0).inputValue(),'fixture-draft');
        if(scenario==='feedback-explicit') await selects.nth(0).selectOption('fixture-todo');
        await selects.nth(1).selectOption('user@example.test');
      } else {
        await page.getByRole('button',{name:scenario==='lane'?'New issue in Todo':'New issue',exact:true}).click();
        await page.getByRole('textbox',{name:'Issue title',exact:true}).fill('Synthetic Draft-default verification');
        if(scenario==='status') {
          await page.getByRole('button',{name:'Status: Private planning',exact:true}).click();
          await page.getByRole('combobox',{name:'Search status'}).press('ArrowDown');
          await page.getByRole('combobox',{name:'Search status'}).press('Enter');
          await page.getByRole('button',{name:'Status: Todo',exact:true}).waitFor();
        }
        await page.getByRole('button',{name:'Assignee',exact:true}).click();
        await page.getByRole('option',{name:'Fixture user',exact:true}).click();
      }
      await page.locator('input[type="date"]').fill('2026-11-01');
      await page.getByRole('button',{name:'Create issue',exact:true}).click();
      await page.waitForFunction(name=>window.originPagesFixture.calls.some(call=>call.name===name),feedback?'feedback:convert':'tasks:createTask');
      const calls=await page.evaluate(()=>window.originPagesFixture.calls);
      const mutation=calls.find(c=>c.name===(feedback?'feedback:convert':'tasks:createTask'));
      if(scenario==='default'||scenario==='feedback-default') assert.equal(Object.hasOwn(mutation.args,'columnId'),false);
      else assert.equal(mutation.args.columnId,'fixture-todo');
      assert.deepEqual(errors,[]);
      rows.push({width,reducedMotion,scenario,mutation,errors});console.log(JSON.stringify(rows.at(-1)));
    } finally {await context.close();}
  }
  writeFileSync('docs/verification/evidence/origin-draft-defaults-031/browser-flows.json',JSON.stringify({synthetic:true,rows},null,2)+'\n');
} finally {await browser.close();}
