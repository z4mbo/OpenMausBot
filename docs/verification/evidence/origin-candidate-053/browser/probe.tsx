import {useEffect} from 'react';
import {useStore} from '/src/state/store.tsx';

export function FixtureProbe(){
 const {state}=useStore();
 const summary={hydrated:state.hydrated,selectedId:state.selectedId,activeView:state.activeView,bots:state.bots.map(bot=>({id:bot.id,name:bot.name,threadId:bot.threadId,awaitingThreadSnapshot:bot.awaitingThreadSnapshot===true,switchingTo:bot.switchingTo??null,approvalMode:bot.approvalMode,autoApprove:bot.autoApprove,tasks:bot.tasks?.map(task=>({threadId:task.threadId,title:task.title,approvalMode:task.approvalMode,autoApprove:task.autoApprove})),messages:bot.messages.map(message=>({id:message.id,role:message.role,kind:message.kind,text:message.kind==='text'?message.text:undefined}))}))};
 const key=JSON.stringify(summary);
 useEffect(()=>{
  Object.assign(window,{__originThreadRecovery:summary});
  void fetch('/__fixture/observe',{method:'POST',headers:{'content-type':'application/json'},body:key}).catch(()=>{});
 },[key]);
 return null;
}
