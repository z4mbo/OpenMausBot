import { useState } from "react";
import { createPortal } from "react-dom";
import { Network, UserPlus } from "lucide-react";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, openBotThread } from "@/state/thread-navigation";
import { useStore, type Bot } from "@/state/store";
import { NewBotDialog } from "./lazy-screens";
import { AgentsFlow } from "./agents-flow/AgentsFlow";
import { ProjectRoom, useProjectRoom } from "./agents-flow/ProjectRoom";
import { GroupTaskPicker } from "./TaskPicker";
import { EmptyState, Segmented, pageClass } from "./origin-pages/ui";

type AgentsView = "room" | "flow";

const VIEW_KEY = "origin-agents-view";

function savedView(): AgentsView {
  try {
    return globalThis.localStorage?.getItem(VIEW_KEY) === "flow" ? "flow" : "room";
  } catch {
    return "room";
  }
}

function saveView(view: AgentsView) {
  try { globalThis.localStorage?.setItem(VIEW_KEY, view); } catch { /* a per-browser preference only */ }
}

const toolButton = "relative flex size-9 shrink-0 items-center justify-center rounded-xl text-ink transition-colors duration-150 hover:bg-raised/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

export function ProjectAgentsPage({ lead, agents }: { lead: Bot; agents: readonly Bot[] }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<AgentsView>(savedView);
  const team = lead.section?.trim();
  const open = (bot: Bot, threadId?: string) => {
    if (threadId && threadId !== bot.threadId && bot.tasks?.some((task) => task.threadId === threadId)) openBotThread(dispatch, bot, threadId, showThreads);
    else openBot(dispatch, bot, showThreads);
  };
  const pick = (next: AgentsView) => { setView(next); saveView(next); };
  const controls = (
    <div data-agents-controls className="flex shrink-0 items-center gap-1">
      <Segmented label="Agents view" value={view} onChange={pick} options={[
        { value: "room", label: "Group chat" },
        { value: "flow", label: "Flow" },
      ]} />
      <button type="button" className={toolButton} aria-label="Team map" title="Team map" onClick={() => dispatch({ type: "showTeamMap" })}><Network size={18} /></button>
      {team && <button type="button" className={toolButton} aria-label="Add agent" title="Add agent" onClick={() => setAdding(true)}><UserPlus size={18} /></button>}
    </div>
  );
  return (
    <>
      {view === "room" ? (
        <section aria-label="Agents" className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">
          <ProjectRoom lead={lead} agents={agents} headerEnd={controls} />
        </section>
      ) : (
        <section aria-label="Agents" className={pageClass}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <FlowTitle lead={lead} agents={agents} />
            {controls}
          </div>
          <AgentsFlow lead={lead} agents={agents} onOpen={open} onSettings={(bot) => dispatch({ type: "toggleSettings", botId: bot.id, open: true })} />
          {!agents.length && <EmptyState compact icon={<Network size={22} />} title={`${lead.name} works alone for now`} />}
        </section>
      )}
      {adding && team && createPortal(<NewBotDialog section={team} preserveSelection onClose={() => setAdding(false)} />, document.body)}
    </>
  );
}

function FlowTitle({ lead, agents }: { lead: Bot; agents: readonly Bot[] }) {
  const { room } = useProjectRoom(lead, agents);
  if (!room) return <span />;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-[15px] font-semibold text-ink">{room.name}</span>
      <GroupTaskPicker group={room} />
    </div>
  );
}
