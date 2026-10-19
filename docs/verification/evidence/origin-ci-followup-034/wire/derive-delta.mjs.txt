import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here,'../..');
const require = createRequire(join(root,'package.json'));
const { build } = require('esbuild');
const git = (args) => execFileSync('git',args,{cwd:root,maxBuffer:4*1024*1024});
const baseline = git(['rev-parse','795ca0077^']).toString().trim();
const source = 'f44ebe30a9568ed634b9eb8a45476f42e4c059b1';
const hash = (wire) => createHash('sha256').update(wire).digest('hex');
const modulePaths = ['server/drivers/agents-catalog.ts','server/drivers/agents-bridge.ts'];
const files = [...modulePaths,'server/agent-tool-policy.ts','server/drivers/agents-widget-tools.ts','shared/credential-request.ts','shared/options-card.ts'];
const changedFiles = git(['diff',baseline,source,'--name-only','--',...files]).toString().trim().split(/\r?\n/).filter(Boolean);
assert.deepEqual(changedFiles,modulePaths.slice().sort());
async function load(label,old) {
  const output = join(here,`${label}-catalog.mjs`);
  await build({stdin:{contents:'export * from "./server/drivers/agents-catalog.ts"; export * from "./server/drivers/agents-bridge.ts";',resolveDir:root},bundle:true,platform:'node',format:'esm',target:'node24',outfile:output,logLevel:'silent',plugins:old?[{name:'frozen-pre-branding-source',setup(context){context.onLoad({filter:/[\\/]agents-(catalog|bridge)\.ts$/},({path})=>({contents:git(['show',`${baseline}:${path.slice(root.length+1).replaceAll('\\','/')}`]).toString(),loader:'ts'}));}}]:[]});
  return import(pathToFileURL(output).href);
}
const previous = await load('previous',true);
const current = await load('current',false);
const results = [];
for (const bridged of [false,true]) {
  const fixture = `server/drivers/agents-catalog-goldens/${bridged?'bridged.profiles.json':'profiles.json'}`;
  const pinned = JSON.parse(git(['show',`${source}:${fixture}`]).toString());
  for (const [name,oldPin] of Object.entries(pinned)) {
    const env = {OMB_BOT_ID:'bot-golden',OMB_CHIEF_OF_STAFF:name.includes('non-chief')?'0':'1',OMB_SKILL_AUTHORING_ENABLED:name.includes('skills')?'1':'0',OMB_SHARED_COMPUTERS_ENABLED:name.includes('shared')?'1':'0',OMB_VOICE_NOTES:name.includes('voice')?'1':'0',...(name.includes('cloud-home')?{OMB_CLOUD_HOME:'1'}:{}),...(name.includes('escalations')?{OMB_ESCALATIONS:'1'}:{})};
    if(name.includes('legacy-switches'))Object.assign(env,{OMB_ROOM_TURN:'1',OMB_OWN_THREAD_CREATION:'1',OMB_EXTERNAL_RUNTIME:'1'});
    const get = (module) => {const catalog=module.availableTools(module.catalogProfileFromEnv(env));return {tools:bridged?module.createToolBridge(catalog).listed:catalog};};
    const oldCatalog=get(previous),newCatalog=get(current);
    const oldWire=JSON.stringify(oldCatalog),newWire=JSON.stringify(newCatalog);
    assert.equal(Buffer.byteLength(oldWire),oldPin.bytes,`${name}: baseline bytes`);
    assert.equal(hash(oldWire),oldPin.sha256,`${name}: baseline hash`);
    assert.deepEqual(oldCatalog.tools.map(tool=>tool.name),oldPin.tools,`${name}: baseline names`);
    assert.equal(oldWire.replaceAll('OpenMausBot','Origin'),newWire,`${name}: non-branding serialized drift`);
    const fields=[];
    function compare(oldValue,newValue,path) {
      if(JSON.stringify(oldValue)===JSON.stringify(newValue))return;
      assert.equal(typeof oldValue,typeof newValue,path);
      if(typeof oldValue==='string') {
        assert(path.endsWith('.description'),`${name}: changed non-description field ${path}`);
        assert.equal(oldValue.replaceAll('OpenMausBot','Origin'),newValue,path);
        fields.push({path,replacements:oldValue.split('OpenMausBot').length-1,byteDelta:Buffer.byteLength(newValue)-Buffer.byteLength(oldValue)});
        return;
      }
      assert(oldValue&&newValue&&typeof oldValue==='object',path);
      assert.deepEqual(Object.keys(oldValue),Object.keys(newValue),path);
      for(const key of Object.keys(oldValue))compare(oldValue[key],newValue[key],`${path}.${key}`);
    }
    compare(oldCatalog,newCatalog,'catalog');
    const replacements=fields.reduce((sum,field)=>sum+field.replacements,0);
    assert.equal(Buffer.byteLength(newWire)-Buffer.byteLength(oldWire),-5*replacements);
    results.push({profile:name,bridged,tools:newCatalog.tools.length,old:{bytes:Buffer.byteLength(oldWire),sha256:hash(oldWire)},current:{bytes:Buffer.byteLength(newWire),sha256:hash(newWire)},replacements,fields:fields.map(field=>({...field,tool:newCatalog.tools[Number(field.path.split('.')[2])]?.name}))});
  }
}
const report={baseline,source,brandCommit:'795ca0077c4562e731563bacad33e96f8591790e',changedProductionInputs:changedFiles,invariant:'Every profile is byte-identical after replacing only OpenMausBot with Origin in description fields; tool names/order, schema structure and values, annotations, required fields, permissions and bridge logic are unchanged.',profiles:results};
writeFileSync(join(here,'catalog-delta.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({baseline,source,profilesCompared:results.length,unbridgedDefault:results.find(result=>result.profile==='default'&&!result.bridged),bridgedDefault:results.find(result=>result.profile==='default'&&result.bridged),allByteDeltas:[...new Set(results.map(result=>result.current.bytes-result.old.bytes))]},null,2));
