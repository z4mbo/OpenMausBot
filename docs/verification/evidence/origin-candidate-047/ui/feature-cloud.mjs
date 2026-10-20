export * from '/src/lib/origin-cloud/index.ts';
import {useCloudSession as realSession,useCloudUrl as realUrl} from '/src/lib/origin-cloud/hooks.ts';
import {newNode} from '/shared/canvas-ops.ts';
import {encodeNode} from '/shared/canvas-scene.ts';

const active=location.pathname==='/__features046.html';
const params=new URLSearchParams(location.search), mode=params.get('state')??'data';
const now=Date.now(), editor=params.get('access')!=='viewer';
const user={_id:'feature-review-user',name:'Synthetic reviewer',email:'reviewer@example.test'};
const session={user,token:'synthetic-ui-session-only',ready:true,login:async()=>{throw new Error('Fixture sign-in is disabled')},logout:async()=>{}};
const project={_id:'feature-project',teamId:'feature-team',name:'Origin feature review',memberRole:editor?'owner':'viewer'};
const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#152936"/><circle cx="320" cy="230" r="115" fill="#7aadd1"/><path d="M80 400 L280 130 L530 400 Z" fill="#376b94"/><text x="32" y="54" fill="white" font-family="sans-serif" font-size="24">Synthetic studio preview</text></svg>');
const generation=(id,patch)=>({_id:id,projectId:project._id,mode:'image',model:'fal-ai/nano-banana-pro',modelLabel:'Nano Banana Pro',kind:'image',prompt:'A calm geometric illustration for the project landing page',aspectRatio:'4:3',status:'done',outputs:[{url:art,kind:'image',contentType:'image/svg+xml'}],saved:[],broadcast:[],createdByName:user.name,createdAt:now-60000,updatedAt:now-1000,...patch});
const generations=[generation('generation-ready',{}),generation('generation-working',{status:'running',outputs:[],startedAt:now-30000}),generation('generation-failed',{status:'failed',outputs:[],error:'Synthetic generation failure: no provider was contacted.'})];
const posts=[{_id:'post-draft',projectId:project._id,variants:[{channel:'x',text:'A synthetic launch announcement prepared by the project team.'}],assetIds:[],status:'draft',agentName:'Copywriter',createdAt:now-60000,updatedAt:now,media:[],needsApproval:true},{_id:'post-scheduled',projectId:project._id,variants:[{channel:'bluesky',text:'Synthetic scheduled project update.'}],assetIds:[],status:'scheduled',scheduledAt:now+3600000,createdAt:now-60000,updatedAt:now,media:[],needsApproval:false}];
const lead=(id,name,stage,value)=>({_id:id,projectId:project._id,name,company:'Example Studio',email:id+'@example.test',source:'Synthetic fixture',stage,order:1,value,tags:['Review'],nextStep:'Arrange a product walkthrough',createdAt:now-3600000,updatedAt:now});
const leads=[lead('lead-aria','Aria Example','New',1200),lead('lead-robin','Robin Example','Qualified',5000),lead('lead-sam','Sam Example','Proposal',3200)];
const nodes=[newNode('frame',null,1,{id:'feature-frame',name:'Landing hero',x:0,y:0,width:640,height:420,fill:'#e7edf2',radius:16}),newNode('text','feature-frame',1,{id:'feature-heading',name:'Heading',x:48,y:54,width:480,height:70,text:'Every project gets a team',fontSize:36,fontWeight:700,fill:'#162b3a'}),newNode('rect','feature-frame',2,{id:'feature-button',name:'Primary button',x:48,y:180,width:210,height:54,fill:'#347eb0',radius:12}),newNode('text','feature-frame',3,{id:'feature-button-label',name:'Button label',x:68,y:193,width:170,height:28,text:'Start a project',fontSize:18,fill:'#ffffff'})];
const org={agents:[{_id:'head',kind:'head',name:'Django',title:'Workspace Chief',color:'#347eb0',engine:'claude',model:'opus',phase:'idle',liveRuns:0,runs:8,tokens:42000,costUsd:0},{_id:'chief',kind:'chief',projectId:project._id,name:'Origin',title:'Project Chief',color:'#347eb0',engine:'claude',model:'opus',phase:'working',task:'Reviewing the next project milestone',liveRuns:1,runs:12,tokens:98000,costUsd:0},{_id:'researcher',kind:'agent',projectId:project._id,name:'Researcher',color:'#668bc4',engine:'codex',model:'gpt-5.6',phase:'waiting_approval',task:'Waiting for a project decision',liveRuns:1,runs:4,tokens:19000,costUsd:0.12}],projects:[{_id:project._id,name:project.name,accent:'#347eb0'}],truncated:false};
const empty=mode==='empty';
const values={
 'projects:get':project,'workspaces:list':[{_id:'feature-team',name:'Synthetic workspace'}],'projects:listForUser':[project],
 'studio:list':empty?[]:generations,'design:list':{assets:[],folders:[]},
 'broadcast:list':{canEdit:editor,posts:empty?[]:posts},
 'pipeline:board':{stages:['New','Contacted','Qualified','Proposal','Won','Lost'],leads:empty?[]:leads,settings:{configured:false,captureEnabled:false,autoSend:false,currency:'USD'},pending:[]},
 'members:people':[{userId:user._id,name:user.name,email:user.email}],
 'draw:canvases':empty?[]:[{_id:'feature-canvas',name:'Landing design'}],'draw:scene':empty?[]:nodes.map(encodeNode),'draw:presence':[],'draw:files':[],
 'org:tree':empty?{agents:[],projects:[],truncated:false}:org,
};
const loadingNames=new Set(['studio:list','broadcast:list','pipeline:board','draw:canvases','draw:scene','org:tree']);
export function useCloudQuery(name,args){if(args==='skip')return undefined;if(!active){if(name==='workspaces:list')return[{_id:'team',name:'Origin review workspace'}];if(name==='projects:listForUser')return[{_id:'project',teamId:'team',name:'Origin'}];return []}if(mode==='loading'&&loadingNames.has(name))return undefined;if(name==='pipeline:lead'){const found=leads.find(lead=>lead._id===args.leadId);return found?{lead:found,activities:[{_id:'activity-note',leadId:found._id,kind:'note',status:'logged',actor:{kind:'member',name:user.name},body:'Synthetic lead note for UI inspection.',createdAt:now,updatedAt:now}]}:null}return values[name]??[]}
export function useCloudSession(){return active?session:realSession()}
export function useCloudUrl(){return active?location.origin:realUrl()}
const deny=async(name)=>{globalThis.__featureFixture?.blocked.push({kind:'cloud',name});throw new Error('The feature UI fixture blocks cloud mutations; nothing was saved or sent.')};
export function cloudMutation(name){return deny(name)}
export function cloudAction(name){return deny(name)}
export async function cloudQueryOnce(name,args){return useCloudQuery(name,args)}
export const featureDataScope={screen:params.get('screen')??'studio',state:mode,access:editor?'editor':'viewer',syntheticAuth:true,providerCredentials:false,externalMutation:false};
