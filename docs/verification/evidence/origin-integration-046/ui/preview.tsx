import { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreContext, initialState, reducer, currentTaskBot } from '/src/state/store';
import { DesktopCapabilitiesProvider } from '/src/components/DesktopCapabilities';
import { ThreadRefsProvider } from '/src/components/ThreadRefs';
import { ChatView } from '/src/components/ChatView';
import { ChiefSectionBar } from '/src/components/ChiefSections';
import { ModelSection } from '/src/components/bot-settings/ModelSection';
import { ModelHostingSettings } from '/src/components/ModelHostingSettings';
import { SettingsModal } from '/src/components/SettingsModal';
import { applySkin } from '/src/lib/skins';
import { applyChatWidth } from '/src/lib/chat-width';
import { setLocale } from '/src/lib/i18n';
import '/src/styles.css';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'agent';
setLocale('en');
applySkin(params.get('theme') === 'light' ? 'atelier' : 'midnight');
applyChatWidth(params.get('width') ?? 'standard');
const profiles = [
 { instanceId:'claude',driverKind:'claudeAgent',displayName:'Claude',snapshot:{state:'available',authenticated:true,billing:'subscription'},models:{default:'opus',options:[{id:'opus',label:'Opus'},{id:'sonnet',label:'Sonnet'}]}},
 { instanceId:'chatgpt',driverKind:'codex',displayName:'ChatGPT',snapshot:{state:'available',authenticated:true,billing:'subscription',chatgptPlan:true},models:{default:'gpt-5.6',options:[{id:'gpt-5.6',label:'GPT-5.6'}]}},
 { instanceId:'openrouter',driverKind:'openai-compat',displayName:'OpenRouter API',access:'api',snapshot:{state:'available',authenticated:true,billing:'metered'},models:{default:'anthropic/claude-sonnet',options:[{id:'anthropic/claude-sonnet',label:'Claude Sonnet'}]}}
];
const now=Date.now();
const messages=[
 {id:'u1',role:'user',kind:'text',at:now-2000,text:'Review this project change and show me the pull request.'},
 {id:'a1',role:'bot',kind:'text',at:now-1000,text:'The focused change is ready for review. I checked the new behavior and the regression coverage. You can inspect the pull request below; merging requires your confirmation.'},
 {id:'pr',role:'bot',kind:'activity',at:now,tool:{name:'origin_review_pr',ok:true},originPullRequest:{projectId:'project',projectName:'Origin',number:7,title:'Keep shared conversations on their original project thread',url:'https://github.com/example/synthetic/pull/7',state:'open',branch:'origin/ORI-TEST-shared-thread',baseBranch:'main',headSha:'a'.repeat(40),additions:120,deletions:8,files:4,checks:'success',review:'approved',mergeable:true,closes:['ORI-TEST']}}
];
const bot={id:'atlas',threadId:'thread',name:'Atlas',title:'Researcher',description:'',color:'blue',notifications:true,unread:false,busy:false,messages,modelSelection:{instanceId:'claude',model:'opus'},fallback:[{instanceId:'chatgpt',model:'gpt-5.6'},{instanceId:'openrouter',model:'anthropic/claude-sonnet'}],quotaFallback:true,fallbackApiAllowed:false,tasks:[{threadId:'thread',title:'Shared project review',createdAt:now,usage:{input:21000,output:1400,costUsd:null,turns:3,context:{tokens:20000,window:100000}}}]};

function Fixture(){
 const [state,dispatch]=useReducer(reducer,{...initialState,bots:[bot],instances:profiles,selectedId:bot.id,appSettingsOpen:screen==='settings',appSettingsSection:'integrations'});
 const [section,setSection]=useState('agents');
 const current=state.bots[0];
 return <StoreContext value={{state,dispatch,flushBotPatches:async()=>null,refreshInstances:async()=>{},refreshModels:async()=>{}}}><ThreadRefsProvider><div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-app text-ink">
 <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline/40 px-3 py-2 text-[11px] text-ink-secondary"><span>Isolated merged UI · synthetic state</span>{['agent','hosting','chat','settings','tabs'].map(value=><a key={value} href={`?screen=${value}&theme=${params.get('theme')??'dark'}&width=${params.get('width')??'standard'}`} className="rounded px-1.5 py-1 hover:bg-control">{value}</a>)}</header>
 {screen==='chat'?<ChatView bot={currentTaskBot(current)}/>:screen==='settings'?<SettingsModal/>:screen==='tabs'?<><ChiefSectionBar bot={{...current,name:'Origin',chiefOfStaff:true}} section={section} onSection={setSection}/><p className="p-4 text-[13px] text-ink-secondary">Selected project section: {section}. This screen checks the actual navigation bar only.</p></>:<main className="min-w-0 flex-1 overflow-y-auto p-4"><div className="mx-auto grid min-w-0 max-w-3xl gap-4">{screen==='hosting'?<ModelHostingSettings/>:<ModelSection bot={current}/>}</div></main>}
 </div></ThreadRefsProvider></StoreContext>;
}
createRoot(document.getElementById('root')).render(<DesktopCapabilitiesProvider><Fixture/></DesktopCapabilitiesProvider>);
