import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Network, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { delegationBrief, isDelegatedThread } from "@/lib/delegation";
import { useThreadTranscript } from "@/lib/thread-transcript";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { useStore, type Bot, type Task } from "@/state/store";
import { NewBotDialog } from "./lazy-screens";
import { BotAvatar } from "./Avatar";
import { ChatView } from "./ChatView";
import { GlassHeader } from "./GlassScrollFrame";
import { UnreadBadge } from "./UnreadBadge";

const chosenAgent = new Map<string, string>();

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

export function ProjectAgentsPage({ lead, agents }: { lead: Bot; agents: readonly Bot[] }) {
  const { dispatch } = useStore();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState(() => chosenAgent.get(lead.id));
  const [phoneChat, setPhoneChat] = useState(false);
  const [chatHead, setChatHead] = useState<HTMLDivElement | null>(null);
  const selected = agents.find((agent) => agent.id === picked) ?? agents[0];
  const team = lead.section?.trim();
  const pick = (agent: Bot) => {
    chosenAgent.set(lead.id, agent.id);
    setPicked(agent.id);
    setPhoneChat(true);
  };
  return (
    <section aria-label="Agents" className="flex min-h-0 flex-1 pt-[var(--glass-top,0px)]">
      <GlassHeader>
        <div data-agents-header className="flex min-h-12 items-center">
          <div className={cn("flex h-12 w-full shrink-0 items-center gap-1 pl-4 pr-2 md:w-72", phoneChat && "max-md:hidden")}>
            <h2 className="flex-1 text-[13px] font-semibold text-ink-secondary">Agents</h2>
            <button type="button" className={iconButton} aria-label="Team map" title="Team map" onClick={() => dispatch({ type: "showTeamMap" })}><Network size={16} /></button>
            {team && <button type="button" className={iconButton} aria-label="New agent" title="New agent" onClick={() => setAdding(true)}><UserPlus size={16} /></button>}
          </div>
          {phoneChat && (
            <button type="button" onClick={() => setPhoneChat(false)} aria-label="Back to agents" className={cn(iconButton, "ml-2 md:hidden")}>
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
          )}
          <div ref={setChatHead} className={cn("min-w-0 flex-1", !phoneChat && "max-md:hidden")} />
        </div>
      </GlassHeader>
      <nav aria-label={`${lead.name} agents`} className={cn("flex min-h-0 w-full shrink-0 flex-col border-hairline/40 pt-1 md:w-72 md:border-r", phoneChat && "max-md:hidden")}>
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          <AgentRow bot={lead} lead onSelect={() => setChiefSectionOf(lead.id, "chat")} />
          {agents.map((agent) => <AgentRow key={agent.id} bot={agent} active={agent.id === selected?.id} onSelect={() => pick(agent)} />)}
          {!agents.length && (
            <li className="flex flex-col items-start gap-2 px-2 pt-4 text-[13px] text-ink-secondary">
              <span>{lead.name} works alone for now.</span>
              {team && <button type="button" onClick={() => setAdding(true)} className="rounded-lg bg-raised px-2.5 py-1 font-medium text-ink transition-colors duration-150 hover:bg-raised-hover">New agent</button>}
            </li>
          )}
        </ul>
      </nav>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !phoneChat && "max-md:hidden")}>
        {selected ? (
          <ChatView key={selected.id} bot={selected} embedded headerSlot={chatHead} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-ink-secondary">
            <Users size={22} aria-hidden="true" className="text-ink-tertiary" />
            Add an agent to give {lead.name} someone to hand work to.
          </div>
        )}
      </div>
      {adding && team && createPortal(<NewBotDialog section={team} preserveSelection onClose={() => setAdding(false)} />, document.body)}
    </section>
  );
}

function busyTask(bot: Bot): Task | undefined {
  return bot.tasks?.find((task) => task.activity === "waiting-on-you") ?? bot.tasks?.find((task) => task.busy || task.activity === "working");
}

function AgentRow({ bot, lead = false, active = false, onSelect }: { bot: Bot; lead?: boolean; active?: boolean; onSelect(): void }) {
  const task = busyTask(bot);
  const delegated = task && isDelegatedThread(task, bot.id) ? task : undefined;
  const thread = useThreadTranscript(delegated?.threadId);
  const request = thread?.findLast((message) => message.roomRequest?.phase === "request");
  const subject = delegated ? delegationBrief(request, bot.name) : task?.title && task.title !== "New thread" ? task.title : "";
  const waiting = task?.activity === "waiting-on-you" || bot.activity === "waiting-on-you";
  const working = Boolean(task) || Boolean(bot.busy);
  const status = waiting ? delegated?.openedBy ? `Needs you in the ${delegated.openedBy.name} chat` : "Needs you"
    : working ? subject ? `Working on: ${subject}` : "Working"
    : bot.waitingForTeammates ? "Waiting on its agents" : "Idle";
  const unread = botShowsUnread(bot) ? unreadReplies(bot) : 0;
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined}
        className={cn("flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent/60",
          active ? "bg-raised" : "hover:bg-raised/50")}>
        <span className="relative shrink-0">
          <BotAvatar bot={bot} size={32} animated={working} state={working ? "working" : undefined} />
          <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-app",
            waiting ? "bg-warning" : working ? "bg-success motion-safe:animate-pulse" : "bg-ink-tertiary/60")} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-ink">{bot.name}</span>
            {lead ? <span className="shrink-0 text-[12px] text-ink-tertiary">Lead</span>
              : bot.title ? <span className="truncate text-[12px] text-ink-tertiary">{bot.title}</span> : null}
            <UnreadBadge count={unread} />
          </span>
          <span data-agent-status className={cn("block truncate text-[12px]", waiting ? "text-warning" : "text-ink-secondary")} title={status}>{status}</span>
        </span>
      </button>
    </li>
  );
}
