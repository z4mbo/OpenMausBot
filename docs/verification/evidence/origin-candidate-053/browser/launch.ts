import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {join,resolve} from 'node:path';
import {launchVerificationServer,runControlOmb,type VerificationServer} from '../../../scripts/control-omb.ts';
import {mountPreview,parkUntilSignal,type MountedPreview} from '../../../scripts/testing/preview-fixture.ts';
import {STANDALONE_SECTION} from '../../../shared/origin-workspaces.ts';

const own=import.meta.dirname,root=resolve(own,'../../..'),source='ec3683b171438905c6171d838ab11c559e1bfa49',owner=randomUUID();
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const frozen=execFileSync('git',['show',source+':src/state/store.tsx'],{cwd:root,maxBuffer:4*1024*1024});
assert(!existsSync(join(own,'handle.json')),'Use a fresh fixture directory; retained handles require reconciliation');
writeFileSync(join(own,'store.before.frozen.tsx'),frozen,{flag:'wx'});
let sequence=0;
const log=(entry:Record<string,unknown>)=>appendFileSync(join(own,'requests-events.jsonl'),JSON.stringify({sequence:++sequence,at:new Date().toISOString(),...entry})+'\n');
const save=(name:string,value:unknown)=>writeFileSync(join(own,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const bodyOf=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;assert(size<=2*1024*1024,'Fixture request body bound');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const abort=new AbortController();
const streamResponses=new Set<ServerResponse>();
const previews:MountedPreview[]=[];
const realFrames:Array<{id:string;frame:any}>=[];
const liveDeliveries=new Set<(row:{id:string;frame:any})=>void>();
let fixture:VerificationServer|undefined,capture:Promise<void>|undefined;
let botId='',threadA='',threadB='';
const requests=new Set<AbortController>();
try{
 fixture=await launchVerificationServer({...process.env,OMB_TEST_PORTS:'22400-22439',FAKE_CLAUDE_MODE:'happy',FAKE_CLAUDE_TOOL_CALLS:'[]',FAKE_CLAUDE_REPLIES:JSON.stringify(['Synthetic pinned thread A response.'])});
 const base=fixture.info.url;
 assert(![5199,8799,3210,3211,5174].includes(Number(new URL(base).port)));
 const api=async(method:string,path:string,body?:unknown)=>{
  const response=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await response.arrayBuffer());log({source:'seed-http',method,path,status:response.status,request:body??null,responseSha256:sha(bytes)});assert(response.ok,method+' '+path+' HTTP'+response.status);return JSON.parse(bytes.toString());
 };
 capture=(async()=>{
  const response=await fetch(base+'/api/events?screens=off',{headers:{origin:base,accept:'text/event-stream'},signal:abort.signal});assert(response.ok&&response.body);
  let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');text=text.replaceAll('\r\n','\n');let end;while((end=text.indexOf('\n\n'))>=0){const block=text.slice(0,end);text=text.slice(end+2);const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)continue;const id=block.split('\n').find(line=>line.startsWith('id:'))?.slice(3).trim()??'';const frame=JSON.parse(data);const row={id,frame};realFrames.push(row);log({source:'actual-server-sse',id,frame});for(const delivery of liveDeliveries)delivery(row);}}
 })().catch(error=>{if(!abort.signal.aborted)throw error;});
 const waitFrame=async(test:(frame:any)=>boolean,after=0)=>{const deadline=Date.now()+15000;for(;;){const frame=realFrames.slice(after).find(row=>test(row.frame));if(frame)return structuredClone(frame);assert(Date.now()<deadline,'Expected actual server frame was not emitted');await sleep(25);}};
 const hello=await waitFrame(frame=>frame.kind==='hello');
 const initial=await api('GET','/api/bots?messages=200');assert.equal(initial.bots.length,1);botId=initial.bots[0].id;threadA=initial.bots[0].threadId;
 await api('PATCH',`/api/bots/${botId}/profile`,{name:'Thread recovery'});
 await api('PATCH',`/api/bots/${botId}`,{section:STANDALONE_SECTION});
 await api('PATCH',`/api/bots/${botId}/tasks/${threadA}`,{title:'Pinned thread A'});
 await runControlOmb(['send','--bot',botId,'--task',threadA,'--text','Synthetic saved transcript on A.','--url',base]);
 await runControlOmb(['wait','--bot',botId,'--task',threadA,'--timeout','20','--url',base]);
 const aSnapshot=await api('GET','/api/bots?messages=200');save('actual-a-snapshot.json',aSnapshot);
 const start=realFrames.length;
 await api('PATCH',`/api/bots/${botId}/tasks/${threadA}`,{title:'Pinned thread A'});
 const oldA=await waitFrame(frame=>frame.kind==='bot'&&frame.bot.id===botId&&frame.bot.threadId===threadA&&frame.bot.tasks?.length===1&&!Object.hasOwn(frame.bot,'messages'),start);
 const beforeB=realFrames.length;
 const created=await api('POST',`/api/bots/${botId}/tasks`,{title:'Current server thread B'});threadB=created.task.threadId;
 await api('PATCH',`/api/bots/${botId}/tasks/${threadB}`,{title:'Current server thread B'});
 const freshB=await waitFrame(frame=>frame.kind==='bot'&&frame.bot.id===botId&&frame.bot.threadId===threadB&&frame.bot.tasks?.some((task:any)=>task.threadId===threadA)&&frame.bot.tasks?.some((task:any)=>task.threadId===threadB)&&!Object.hasOwn(frame.bot,'messages'),beforeB);
 const bSnapshot=await api('GET','/api/bots?messages=200');assert.equal(bSnapshot.bots[0].threadId,threadB);
 const pinnedA=await api('GET',`/api/threads/${threadA}/messages?limit=200`);save('actual-pinned-a-get.json',pinnedA);
 assert(pinnedA.messages.some((message:any)=>message.kind==='text'&&message.text==='Synthetic saved transcript on A.'));
 assert.equal((await api('GET','/api/bots?messages=0')).bots[0].threadId,threadB,'Pinned GET must not move server selection');
 save('old-a-announcement.json',oldA);save('fresh-b-announcement.json',freshB);save('actual-b-snapshot.json',bSnapshot);
 const seed={owner,source,botId,threadA,threadB,oldAFrameSha256:sha(JSON.stringify(oldA)),freshBFrameSha256:sha(JSON.stringify(freshB)),frozenStoreSha256:sha(frozen),fixture:fixture.info,qualification:'Forced startup network/event ordering using actual synthetic-server bodies and announcements. No reducer dispatch injection, transcript fabrication, approval bypass or provider/account access.'};save('seed.json',seed);
 for(const mode of ['before','after'] as const){
  let channel:{response:ServerResponse;stage:string;freshSent:boolean;id:number}|null=null,connection=0;
  const send=(row:{id:string;frame:any},reason:string)=>{if(!channel||channel.response.destroyed)return;channel.response.write((row.id?'id: '+row.id+'\n':'')+'data: '+JSON.stringify(row.frame)+'\n\n');log({source:'fixture-delivery',mode,connection:channel.id,reason,id:row.id,frame:row.frame});};
  const sendFresh=(reason:string)=>{if(!channel||channel.freshSent||channel.stage==='idle')return;channel.freshSent=true;send(freshB,reason);channel.stage='fresh-b-delivered';};
  liveDeliveries.add(row=>{if(channel?.stage==='fresh-b-delivered')send(row,'actual-server-live-forward');});
  const plugin={
   name:'isolated-thread-recovery-'+mode,enforce:'pre' as const,
   configResolved(config:any){config.server.proxy={'/api':{target:base},'/.well-known/openmausbot/environment':{target:base}};},
   resolveId(id:string){if(id==='virtual:thread-recovery-probe')return '\0thread-recovery-probe';},
   load(id:string){const path=id.split('?')[0].replaceAll('\\','/');if(id==='\0thread-recovery-probe')return readFileSync(join(own,'probe.tsx'),'utf8');if(path.endsWith('/scripts/testing/threads-preview.tsx'))return readFileSync(join(own,'entry.tsx'),'utf8');if(path.endsWith('/src/state/store.tsx')){const current=mode==='before'?frozen:readFileSync(join(root,'src/state/store.tsx'));log({source:'vite-store-load',mode,frozen:mode==='before',sha256:sha(current)});return current.toString('utf8');}if(path.endsWith('/src/state/pending-thread-snapshots.ts'))log({source:'vite-helper-load',mode,sha256:sha(readFileSync(path))});},
   transform(code:string,id:string){if(id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.tsx')){assert.equal(code.split('<StoreProvider>').length,2);return {code:"import {FixtureProbe} from 'virtual:thread-recovery-probe';\n"+code.replace('<StoreProvider>','<StoreProvider><FixtureProbe/>'),map:null};}},
   transformIndexHtml(){return [{tag:'meta',attrs:{'http-equiv':'Content-Security-Policy',content:"connect-src 'self'; form-action 'none'; frame-src 'none'; object-src 'none'"},injectTo:'head-prepend' as const}];},
   configureServer(server:any){server.middlewares.use((req:IncomingMessage,res:ServerResponse,next:()=>void)=>{const url=new URL(req.url??'/',base);if(url.pathname==='/__fixture/info'){res.setHeader('content-type','application/json');res.end(JSON.stringify({mode,botId,threadA,threadB}));return;}if(url.pathname==='/__fixture/observe'){void bodyOf(req).then(bytes=>{const state=JSON.parse(bytes.toString());log({source:'actual-renderer-observation',mode,state});const bot=state.bots.find((bot:any)=>bot.id===botId);if(bot?.threadId===threadA&&bot.awaitingThreadSnapshot)sendFresh('actual-renderer-observed-pending-A');res.end('{}');});return;}if(url.pathname==='/__fixture/log'){res.setHeader('content-type','application/x-ndjson');res.end(readFileSync(join(own,'requests-events.jsonl')));return;}if(!url.pathname.startsWith('/api/'))return next();
    if(url.pathname==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive'});res.flushHeaders();channel={response:res,stage:'idle',freshSent:false,id:++connection};streamResponses.add(res);send(hello,'actual-hello-starts-hydration');const timer=setInterval(()=>{if(!res.destroyed)res.write('data: {"kind":"ping"}\n\n');},10000);res.once('close',()=>{clearInterval(timer);streamResponses.delete(res);if(channel?.response===res)channel=null;});return;}
    void (async()=>{const requestBody=await bodyOf(req),method=req.method??'GET',path=url.pathname+url.search;log({source:'renderer-request',mode,method,path,requestBodySha256:sha(requestBody)});if(method==='GET'&&url.pathname===`/api/threads/${threadA}/messages`)sendFresh('exact-pinned-A-GET-started');const controller=new AbortController();requests.add(controller);try{const response=await fetch(base+path,{method,headers:{origin:base,'content-type':req.headers['content-type']??'application/json'},...(requestBody.length?{body:requestBody}:{}),signal:controller.signal});const bytes=Buffer.from(await response.arrayBuffer());let json:any;try{json=JSON.parse(bytes.toString());}catch{}if(method==='GET'&&url.pathname==='/api/bots'&&url.searchParams.get('messages')==='200'&&channel?.stage==='idle'){assert.equal(json.bots.find((bot:any)=>bot.id===botId).threadId,threadB,'Authoritative snapshot must be actual B');channel.stage='old-a-queued';send(oldA,'queue-actual-slim-A-before-authoritative-snapshot-response');await sleep(100);log({source:'fixture-order-control',mode,action:'release-actual-authoritative-B-snapshot',responseSha256:sha(bytes)});}log({source:'renderer-response',mode,method,path,status:response.status,responseSha256:sha(bytes),bot:json?.bot?{id:json.bot.id,threadId:json.bot.threadId,messages:json.bot.messages?.map((message:any)=>message.id)}:undefined,bots:json?.bots?.map((bot:any)=>({id:bot.id,threadId:bot.threadId,tasks:bot.tasks?.map((task:any)=>task.threadId)}))});res.statusCode=response.status;res.setHeader('content-type',response.headers.get('content-type')??'application/json');res.end(bytes);}finally{requests.delete(controller);}})().catch(error=>{log({source:'fixture-error',mode,error:String(error)});res.statusCode=500;res.end(JSON.stringify({error:String(error)}));});});}
  };
  const preview=await mountPreview(fixture,{entry:'/scripts/testing/threads-preview.tsx',route:'/__thread-recovery.html',title:'Origin thread recovery '+mode,hmr:false,logLevel:'warn',cacheDir:join(fixture.info.dataDir,'vite-'+mode),plugins:[plugin]});previews.push(preview);
 }
 const handle={...seed,pid:process.pid,before:previews[0].previewUrl,after:previews[1].previewUrl,log:join(own,'requests-events.jsonl'),shutdownFile:join(own,'shutdown.request.json'),shutdownRequest:{operation:'stop-thread-recovery',owner}};save('handle.json',handle);console.log(JSON.stringify(handle,null,2));
 const stop=()=>new Promise<void>(done=>{const timer=setInterval(()=>{const path=join(own,'shutdown.request.json');if(!existsSync(path))return;const body=JSON.parse(readFileSync(path,'utf8'));if(body.operation==='stop-thread-recovery'&&body.owner===owner){clearInterval(timer);done();}},500);timer.unref();});
 await Promise.race([parkUntilSignal(),stop()]);
}finally{
 abort.abort();for(const request of requests)request.abort();for(const response of streamResponses)response.destroy();for(const preview of previews.reverse())await preview.close();await capture;await fixture?.close();save('cleanup.json',{owner,pid:process.pid,at:new Date().toISOString(),closedPreviewCount:previews.length,fixturePid:fixture?.info.pid??null,temporaryDataAbsent:fixture? !existsSync(fixture.info.dataDir):true,protectedProcessesTouched:false,trackedEdits:false});
}
