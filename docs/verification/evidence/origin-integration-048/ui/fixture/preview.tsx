import '/__guard048.mjs';
import { createRoot } from 'react-dom/client';
import { useReducer } from 'react';
import { initialState, reducer, StoreContext } from '/src/state/store';
import { BroadcastPage } from '/src/components/origin-broadcast/BroadcastPage';
import { PipelinePage } from '/src/components/origin-pipeline/PipelinePage';
import { ProjectDrawPage } from '/src/components/OriginDraw';
import { OrgPage } from '/src/components/origin-org/OrgPage';
import { ChiefHeartbeatCard } from '/src/components/origin-pages/ChiefHeartbeatCard';
import { CallActionItems } from '/src/components/origin-pages/CallActionItems';
import { applySkin } from '/src/lib/skins';
import { setLocale } from '/src/lib/i18n';
import '/src/styles.css';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'broadcast';
setLocale('en');
applySkin(params.get('theme') === 'light' ? 'atelier' : 'midnight');
const chief = { id: 'fixture-chief', name: 'Atlas', title: 'Chief', chiefOfStaff: true, color: 'green', section: 'Fixture project', messages: [], modelSelection: { instanceId: 'fixture', model: 'fixture' }, threadId: 'fixture-thread', description: '', notifications: false, unread: false };
function Preview() {
  const [state, update] = useReducer(reducer, { ...initialState, bots: [chief], selectedId: chief.id });
  const dispatch = action => { globalThis.__origin048.actions.push({ type: action.type }); update(action); };
  const props = { cloudProjectId: 'fixture-project', projectName: 'Fixture project', agent: chief };
  const role = params.get('role') ?? 'owner';
  return <StoreContext value={{ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <main className="flex h-dvh min-w-0 flex-col overflow-hidden bg-app text-ink">
      <header className="flex shrink-0 flex-wrap gap-1 border-b border-hairline/40 px-3 py-2 text-[11px] text-ink-secondary">
        <span className="mr-2">Isolated merged UI · synthetic data · sends blocked</span>
        {['broadcast', 'pipeline', 'canvas', 'org', 'heartbeat', 'call-actions', 'core-chat', 'core-agent', 'core-hosting'].map(value => <a key={value} className="rounded px-1.5 py-1 hover:bg-control" href={`?screen=${value}&theme=${params.get('theme') ?? 'dark'}&role=${role}`}>{value}</a>)}
      </header>
      {screen === 'broadcast' ? <BroadcastPage {...props} /> : screen === 'pipeline' ? <PipelinePage {...props} /> : screen === 'canvas' ? <ProjectDrawPage {...props} /> : screen === 'org' ? <OrgPage teamId="fixture-team" canEdit={role !== 'viewer'} role={role} me={{ _id: 'fixture-user', name: 'Synthetic reviewer', email: 'reviewer@example.test' }} /> : <div className="min-w-0 flex-1 overflow-auto p-4"><div className="mx-auto max-w-3xl">{screen === 'heartbeat' ? <ChiefHeartbeatCard projectId="fixture-project" /> : <CallActionItems projectId="fixture-project" />}</div></div>}
    </main>
  </StoreContext>;
}
if (screen.startsWith('core-')) await import('/__core048.tsx');
else createRoot(document.getElementById('root')).render(<Preview />);
