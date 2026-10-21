import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {agentBrowser,ensureUiBrowser,ownUiSessionDaemon,sessionEnv} from '../../../scripts/testing/control-omb-ui.ts';
import {closeBrowserSession} from '../../../server/browser-engine.ts';

const own=import.meta.dirname,handle=JSON.parse(readFileSync(join(own,'handle.json'),'utf8'));
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const save=(name:string,value:unknown)=>writeFileSync(join(own,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const api=async(path:string)=>{const response=await fetch(handle.fixture.url+path);assert(response.ok);return response.json();};
const tools=await ensureUiBrowser();
const sessions:Array<{env:NodeJS.ProcessEnv;mode:string}>=[];
const results:Record<string,unknown>={source:handle.source,owner:handle.owner,observedBy:'repository-agent-browser',qualification:handle.qualification,nativeWindowControl:false,productionData:false};
async function waitFor<T>(probe:()=>Promise<T>,accept:(value:T)=>boolean,label:string){
 const until=Date.now()+25000;let value:T;
 do{value=await probe();if(accept(value))return value;await new Promise(done=>setTimeout(done,150));}while(Date.now()<until);
 throw new Error(label+' did not settle: '+JSON.stringify(value));
}
try{
 for(const mode of ['before','after']){
  const home=join(handle.fixture.dataDir,'root-browser-'+mode);mkdirSync(join(home,'tmp'),{recursive:true});
  const env=sessionEnv({home,session:'origin-recovery-'+handle.owner+'-'+mode,chrome:tools.chrome});sessions.push({env,mode});
  await ownUiSessionDaemon(tools.binary,env);
  const call=(args:string[])=>agentBrowser(tools.binary,env,args,60000);
  await call(['open',handle[mode]]);
  const inspect=async()=> (await call(['eval',`JSON.stringify({state:window.__originThreadRecovery??null,inputs:[...document.querySelectorAll('textarea')].map(input=>({label:input.getAttribute('aria-label'),disabled:input.disabled,value:input.value,visible:input.getClientRects().length>0})),busy:[...document.querySelectorAll('[aria-busy="true"]')].map(node=>node.getAttribute('aria-label'))})`])).result;
  const view=await waitFor(inspect,value=>{
   const state=JSON.parse(String(value));const bot=state.state?.bots?.find((row:any)=>row.id===handle.botId);
   return bot?.threadId===handle.threadA&&bot.awaitingThreadSnapshot===(mode==='before')&&state.inputs.some((input:any)=>input.visible&&input.disabled===(mode==='before'));
  },mode+' pinned editor');
  save(mode+'-browser-state.json',JSON.parse(String(view)));
  save(mode+'-browser-snapshot.json',await call(['snapshot']));
  const image=join(own,mode+'-chat.png');await call(['screenshot',image]);
  const server=await api('/api/bots?messages=0');assert.equal(server.bots.find((bot:any)=>bot.id===handle.botId).threadId,handle.threadB);
  results[mode]={image,sha256:sha(readFileSync(image)),serverSelection:handle.threadB,passed:true};
  if(mode==='after'){
   const snapshot=await call(['snapshot']);const refs=snapshot.refs as Record<string,{name?:string;role?:string}>;
   const entries=Object.entries(refs).filter(([,ref])=>ref.role==='textbox'&&ref.name==='Message Thread recovery');assert.equal(entries.length,1);
   await call(['type','@'+entries[0][0],'Recovery verified on pinned thread A.']);await call(['press','Enter']);
   const page=await waitFor(()=>api('/api/threads/'+handle.threadA+'/messages?limit=200'),body=>body.messages.some((message:any)=>message.role==='user'&&message.text==='Recovery verified on pinned thread A.')&&body.messages.some((message:any)=>message.role==='bot'&&message.text?.includes('Recovery verified on pinned thread A.')),'actual pinned A response');
   save('after-sent-page.json',page);
   const current=await api('/api/bots?messages=0');assert.equal(current.bots.find((bot:any)=>bot.id===handle.botId).threadId,handle.threadB);
   const finalImage=join(own,'after-sent-chat.png');await call(['screenshot',finalImage]);
   const consoleState=await call(['console']);save('after-console.json',consoleState);
   assert.equal((consoleState.messages as Array<{type:string}>??[]).filter(row=>row.type==='error').length,0);
   results.send={passed:true,requestedThread:handle.threadA,serverSelection:handle.threadB,actualUserAndFakeReply:true,image:finalImage,sha256:sha(readFileSync(finalImage))};
  }
 }
 results.passed=true;
}catch(error){results.passed=false;results.error=String(error);throw error;}
finally{
 results.browserCleanup=[];
 for(const session of sessions.reverse()) (results.browserCleanup as unknown[]).push({mode:session.mode,closed:await closeBrowserSession(tools.binary,session.env)});
 results.completedAt=new Date().toISOString();save('browser-proof.json',results);console.log(JSON.stringify(results,null,2));
}
