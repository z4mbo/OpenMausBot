import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {agentBrowser,ensureUiBrowser,ownUiSessionDaemon,sessionEnv} from '../../../scripts/testing/control-omb-ui.ts';
import {closeBrowserSession} from '../../../server/browser-engine.ts';
const own=import.meta.dirname,h=JSON.parse(readFileSync(join(own,'handle.json'),'utf8'));
const save=(name:string,body:unknown)=>writeFileSync(join(own,name),JSON.stringify(body,null,2)+'\n',{flag:'wx'});
const api=async(path:string)=>{const response=await fetch(h.fixture.url+path);assert(response.ok);return response.json();};
const page=await api('/api/threads/'+h.threadA+'/messages?limit=200');
const users=page.messages.filter((message:any)=>message.role==='user'&&message.text==='Recovery verified on pinned thread A.');assert.equal(users.length,1);
const reply=page.messages.find((message:any)=>message.role==='bot'&&message.kind==='text'&&message.requestMessageId===users[0].id&&message.turnSucceeded===true);assert(reply);
const server=await api('/api/bots?messages=0');assert.equal(server.bots.find((bot:any)=>bot.id===h.botId).threadId,h.threadB);
save('after-sent-page-reconciled.json',page);
const tools=await ensureUiBrowser(),env=sessionEnv({home:join(h.fixture.dataDir,'root-browser-after'),session:'origin-recovery-'+h.owner+'-after',chrome:tools.chrome});
const receipt:any={readOnlyReconciliation:true,priorRecipe:'browser-proof.json',priorFailure:'Incorrect expectation that the fake response echoes the user text; actual configured/default fake replies are fixed strings.',sendsReplayed:0,userMessages:users.length,userMessageId:users[0].id,assistantMessageId:reply.id,assistantRequestMessageId:reply.requestMessageId,turnSucceeded:true,requestedThread:h.threadA,serverSelectedThread:h.threadB,productionData:false};
try{
 await ownUiSessionDaemon(tools.binary,env);await agentBrowser(tools.binary,env,['open',h.after],60000);
 const until=Date.now()+15000;
 for(;;){const result=await agentBrowser(tools.binary,env,['eval',`JSON.stringify({ready:!document.querySelector('textarea')?.disabled,shown:document.querySelector('[role="log"]')?.textContent??document.querySelector('main')?.textContent,thread:window.__originThreadRecovery?.bots?.find(bot=>bot.id===${JSON.stringify(h.botId)})?.threadId})`]);const view=JSON.parse(String(result.result));if(view.ready&&view.thread===h.threadA&&view.shown?.includes('Recovery verified on pinned thread A.')&&view.shown?.includes(reply.text)){save('after-sent-rendered-state.json',view);break;}assert(Date.now()<until,'Actual sent messages not rendered');await new Promise(done=>setTimeout(done,150));}
 const image=join(own,'after-sent-chat.png');await agentBrowser(tools.binary,env,['screenshot',image]);receipt.image=image;receipt.sha256=createHash('sha256').update(readFileSync(image)).digest('hex');
 const consoleState=await agentBrowser(tools.binary,env,['console']);save('after-console.json',consoleState);assert.equal((consoleState.messages as Array<{type:string}>??[]).filter(row=>row.type==='error').length,0);
 receipt.passed=true;
}finally{receipt.browserClosed=await closeBrowserSession(tools.binary,env);receipt.observedAt=new Date().toISOString();save('after-send-reconciliation.json',receipt);console.log(JSON.stringify(receipt,null,2));}
