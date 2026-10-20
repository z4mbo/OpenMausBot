import {useReducer} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreContext,initialState,reducer} from '/src/state/store';
import {StudioPage} from '/src/components/origin-studio/StudioPage';
import {BroadcastPage} from '/src/components/origin-broadcast/BroadcastPage';
import {PipelinePage} from '/src/components/origin-pipeline/PipelinePage';
import {ProjectDrawPage} from '/src/components/OriginDraw';
import {OrgPage} from '/src/components/origin-org/OrgPage';
import {SettingsModal} from '/src/components/SettingsModal';
import {applySkin} from '/src/lib/skins';
import {setLocale} from '/src/lib/i18n';
import '/src/styles.css';

const params=new URLSearchParams(location.search), screen=params.get('screen')??'studio';
setLocale('en');applySkin(params.get('theme')==='light'?'atelier':'midnight');
const requests=[],blocked=[];
globalThis.__featureFixture={requests,blocked,scope:'Actual feature bodies with synthetic query/session/store responses. Every mutation and non-local HTTP request is blocked. No provider, recipient, production account or backend persistence acceptance.'};
const originalFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input,init={})=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);const method=(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();requests.push({method,path:url.pathname});if(url.origin!==location.origin||!['GET','HEAD'].includes(method)){blocked.push({kind:'http',method,path:url.pathname});throw new Error('The feature UI fixture blocks outgoing mutations and external requests.')}const data=url.pathname==='/api/studio/status'?{fal:params.get('key')==='ready'}:url.pathname==='/api/origin/broadcast/channels'?{channels:{x:false,bluesky:false,linkedin:false,facebook:false,instagram:false,tiktok:false}}:url.pathname==='/api/origin/pipeline/channels'?{channels:{email:false,sms:false,whatsapp:false,call:false,ai_call:false}}:null;return data?new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}}):originalFetch(input,init)};
const chief={id:'feature-chief',threadId:'feature-thread',name:'Origin',title:'Project Chief',description:'',color:'blue',chiefOfStaff:true,section:'Origin',messages:[],notifications:false,unread:false,busy:false,modelSelection:{instanceId:'claude',model:'opus'}};
function Fixture(){const[state,dispatch]=useReducer(reducer,{...initialState,bots:[chief],selectedId:chief.id});const props={cloudProjectId:'feature-project',projectName:'Origin feature review',link:{botId:chief.id,teamId:'feature-team'},agent:chief};return<StoreContext value={{state,dispatch,flushBotPatches:async()=>null,refreshInstances:async()=>{},refreshModels:async()=>{}}}><div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-app text-ink"><header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-hairline/40 px-3 py-2 text-[11px] text-ink-secondary"><span className="mr-2">Isolated feature bodies · synthetic data · sends blocked</span>{['studio','broadcast','pipeline','canvas','org'].map(value=><a key={value} className="rounded px-2 py-1 hover:bg-control" href={`?screen=${value}&state=${params.get('state')??'data'}&theme=${params.get('theme')??'dark'}&access=${params.get('access')??'editor'}`}>{value}</a>)}</header>{screen==='studio'?<StudioPage {...props}/>:screen==='broadcast'?<BroadcastPage {...props}/>:screen==='pipeline'?<PipelinePage {...props}/>:screen==='canvas'?<ProjectDrawPage {...props}/>:<OrgPage teamId="feature-team" role="owner" canEdit={true}/>}</div>{state.appSettingsOpen&&<SettingsModal/>}</StoreContext>}
createRoot(document.getElementById('root')).render(<Fixture/>);
