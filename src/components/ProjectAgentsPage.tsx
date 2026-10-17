import { useState } from "react";
import { createPortal } from "react-dom";
import { Crown, MessageCircle, Network, Plus, Settings } from "lucide-react";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot } from "@/state/thread-navigation";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { UnreadBadge } from "./UnreadBadge";
import { NewBotDialog } from "./lazy-screens";
import { EmptyState, PageHeader, ghostButton, iconButton, pageClass, primaryButton } from "./origin-pages/ui";

export function agentStatus(agent: Bot): { label: string; tone: string; text: string } {
  if (agent.activity === "waiting-on-you") return { label: "Needs you", tone: "bg-warning", text: "text-warning" };
  if (agent.busy) return { label: "Working", tone: "bg-success motion-safe:animate-pulse", text: "text-success" };
  return { label: "Idle", tone: "bg-ink-tertiary/60", text: "text-ink-tertiary" };
}

function lastWords(agent: Bot): string {
  const message = [...(agent.messages ?? [])].reverse().find((item) => item.role === "bot" && item.kind === "text" && item.text?.trim());
  return message?.text?.replace(/\s+/g, " ").trim() ?? "";
}

/** A project's agents, with its lead first: who they are, what they are doing, and a way into each chat. */
export function ProjectAgentsPage({ lead, agents }: { lead: Bot; agents: readonly Bot[] }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const [adding, setAdding] = useState(false);
  const team = lead.section?.trim();
  const working = agents.filter((agent) => agent.busy).length;
  return (
    <section className={pageClass} aria-label="Agents">
      <PageHeader title="Agents" count={`${agents.length + 1} on ${lead.name}${working ? ` · ${working} working` : ""}`}>
        <button type="button" className={ghostButton} onClick={() => dispatch({ type: "showTeamMap" })}><Network size={14} />Team map</button>
        {team && <button type="button" className={primaryButton} onClick={() => setAdding(true)}><Plus size={14} />Add agent</button>}
      </PageHeader>
      <AgentCard agent={lead} lead index={0} onOpen={() => openBot(dispatch, lead, showThreads)} onSettings={() => dispatch({ type: "toggleSettings", botId: lead.id, open: true })} />
      {agents.length ? (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
          {agents.map((agent, index) => (
            <AgentCard key={agent.id} agent={agent} index={index + 1}
              onOpen={() => openBot(dispatch, agent, showThreads)} onSettings={() => dispatch({ type: "toggleSettings", botId: agent.id, open: true })} />
          ))}
        </div>
      ) : (
        <EmptyState compact icon={<Network size={22} />} title={`${lead.name} works alone for now`}
          body="Add agents to this project and hand them issues: each one gets its own chat and computer." />
      )}
      {adding && team && createPortal(<NewBotDialog section={team} preserveSelection onClose={() => setAdding(false)} />, document.body)}
    </section>
  );
}

function AgentCard({ agent, lead = false, index, onOpen, onSettings }: { agent: Bot; lead?: boolean; index: number; onOpen(): void; onSettings(): void }) {
  const status = agentStatus(agent);
  const unread = botShowsUnread(agent) ? unreadReplies(agent) : 0;
  const words = lastWords(agent);
  const title = agent.title?.trim() && agent.title.trim().toLowerCase() !== agent.name.trim().toLowerCase() ? agent.title.trim() : lead ? "Project lead" : "";
  return (
    <div data-agent-card={agent.id} style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      className={cn("group relative flex items-center gap-3.5 rounded-2xl border border-hairline/40 bg-panel p-4 transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-hairline hover:bg-raised/40 hover:shadow-[0_12px_28px_-16px_rgb(0_0_0/0.7)] motion-safe:animate-[rise_0.32s_cubic-bezier(0.22,1,0.36,1)_backwards]",
        lead && "border-accent/25 bg-accent/[0.05] p-5")}>
      <button type="button" onClick={onOpen} aria-label={`Open ${agent.name}`} className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
      <span className="pointer-events-none relative shrink-0">
        <BotAvatar bot={agent} size={lead ? 52 : 44} animated={Boolean(agent.busy)} />
        <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-panel", status.tone)} />
      </span>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate font-semibold text-ink", lead ? "text-[16px]" : "text-[14px]")}>{agent.name}</span>
          {lead && <Crown size={13} className="shrink-0 text-accent-text" aria-label="Project lead" />}
          <UnreadBadge count={unread} />
        </div>
        <div className="flex items-center gap-1.5 text-[12px]">
          {title && <span className="truncate text-ink-secondary">{title}</span>}
          {title && <span className="text-ink-tertiary" aria-hidden="true">·</span>}
          <span className={cn("shrink-0", status.text)}>{status.label}</span>
        </div>
        {words && <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-tertiary">{words}</p>}
      </div>
      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-panel/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 max-md:opacity-100">
        <button type="button" className={iconButton} aria-label={`Chat with ${agent.name}`} title="Chat" onClick={onOpen}><MessageCircle size={15} /></button>
        <button type="button" className={iconButton} aria-label={`${agent.name} settings`} title="Settings" onClick={onSettings}><Settings size={15} /></button>
      </div>
    </div>
  );
}
