import { useState } from "react";
import { ArrowLeft, Bug, FolderGit2, Image, KeyRound, MessageSquareHeart, MessagesSquare, Phone, Settings, Users } from "lucide-react";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import { UnreadBadge } from "./UnreadBadge";
import { useStore, type Bot } from "@/state/store";
import { chiefSectionOf, setChiefSectionOf, type ChiefSection } from "@/lib/origin-chief-section";
export type { ChiefSection };
import { openBot } from "@/state/thread-navigation";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { AssignIssueDialog, AssetsPage, CallPage, FeedbackPage, IssuesPage, ProjectSettingsPage, RepoPage, TeamChatPage, VaultPage, issueBrief, type AssignableIssue } from "./origin-pages";
import { useCloudProjectFor } from "@/lib/origin-cloud-links";

export const CHIEF_SECTIONS = [
  { id: "issues", label: "Issues", icon: Bug, blurb: "Track the project's bugs and tasks, and hand them to its agents." },
  { id: "agents", label: "Agents", icon: Users, blurb: "" },
  { id: "team-chat", label: "Team chat", icon: MessagesSquare, blurb: "Talk with the people in this project." },
  { id: "call", label: "Call", icon: Phone, blurb: "Voice and video calls with the people in this project." },
  { id: "assets", label: "Assets", icon: Image, blurb: "Images, documents and files the team makes for this project." },
  { id: "vault", label: "Vault", icon: KeyRound, blurb: "Keys, logins and secrets this project's agents may use." },
  { id: "repo", label: "Repo", icon: FolderGit2, blurb: "The project's code repository and its pull requests." },
  { id: "feedback", label: "Feedback", icon: MessageSquareHeart, blurb: "What users say about the project, collected in one place." },
  { id: "settings", label: "Settings", icon: Settings, blurb: "Settings for the whole project: its name, members, integrations and defaults for its agents." },
] as const;


export function useChiefSection(botId: string): [ChiefSection, (section: ChiefSection) => void] {
  const [, render] = useState(0);
  return [chiefSectionOf(botId), (next) => { setChiefSectionOf(botId, next); render((n) => n + 1); }];
}

export function teamAgents(bots: readonly Bot[], chief: Bot): Bot[] {
  const team = chief.section?.trim();
  return team ? bots.filter((bot) => !bot.hidden && bot.id !== chief.id && bot.section?.trim() === team) : [];
}

/** Unread replies across a project's agents, which the sidebar does not list one by one. */
export function teamUnread(bots: readonly Bot[], chief: Bot): number {
  return teamAgents(bots, chief).filter((agent) => botShowsUnread(agent)).reduce((sum, agent) => sum + unreadReplies(agent), 0);
}

function agentStatus(agent: Bot): { label: string; tone: string } {
  if (agent.activity === "waiting-on-you") return { label: "Needs you", tone: "bg-warning" };
  if (agent.busy) return { label: "Working", tone: "animate-pulse bg-success" };
  return { label: "Idle", tone: "bg-ink-tertiary/60" };
}

export function ChiefSectionBar({ bot, section, onSection }: { bot: Bot; section: ChiefSection; onSection(section: ChiefSection): void }) {
  const { state } = useStore();
  const agentsUnread = teamUnread(state.bots, bot);
  return (
    <nav aria-label={`${bot.name} sections`} data-chief-sections className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline/40 px-4 py-2 pl-11 md:pl-4">
      <button type="button" onClick={() => onSection("chat")} aria-current={section === "chat" ? "page" : undefined}
        className={cn("mr-2 flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-[14px] font-semibold text-ink hover:bg-raised", section === "chat" && "bg-raised")}>
        <BotAvatar bot={bot} size={22} />
        <span className="max-w-[160px] truncate">{bot.name}</span>
        {unreadReplies(bot) > 0
          ? <UnreadBadge count={unreadReplies(bot)} />
          : <span aria-label={bot.busy ? "Working" : "Idle"} className={cn("size-2 rounded-full", bot.busy ? "animate-pulse bg-success" : "bg-ink-tertiary/60")} />}
      </button>
      {CHIEF_SECTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-current={section === id ? "page" : undefined}
          onClick={() => onSection(id)}
          className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink",
            section === id && "bg-raised text-ink")}>
          <Icon size={14} aria-hidden="true" />{label}
          {id === "agents" && <UnreadBadge count={agentsUnread} />}
        </button>
      ))}
    </nav>
  );
}

export function ChiefSectionPanel({ bot, section }: { bot: Bot; section: Exclude<ChiefSection, "chat"> }) {
  const { state, dispatch } = useStore();
  const cloudProjectId = useCloudProjectFor(bot);
  const showThreads = useShowThreads();
  const [assigning, setAssigning] = useState<AssignableIssue | null>(null);
  const entry = CHIEF_SECTIONS.find((item) => item.id === section)!;
  if (section === "agents") {
    const agents = teamAgents(state.bots, bot);
    return (
      <section className="flex-1 overflow-y-auto p-6" aria-label="Agents">
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-ink">Agents</h2>
          <span className="text-[13px] text-ink-secondary">{agents.length ? `${agents.length} working for ${bot.name}` : "Add agents from the Team map"}</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {agents.map((agent) => {
            const status = agentStatus(agent);
            const unread = botShowsUnread(agent) ? unreadReplies(agent) : 0;
            return (
              <div key={agent.id} data-agent-card={agent.id}
                className="group relative flex items-center gap-3 rounded-xl border border-hairline/40 bg-panel p-4 transition-colors hover:border-hairline hover:bg-raised/40">
                <button type="button" onClick={() => openBot(dispatch, agent, showThreads)} aria-label={`Open ${agent.name}`}
                  className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
                <BotAvatar bot={agent} size={40} />
                <div className="pointer-events-none min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-ink">{agent.name}</span>
                    <UnreadBadge count={unread} />
                  </div>
                  <div className="truncate text-[12px] text-ink-secondary">{agent.title || "Agent"}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
                    <span className={cn("size-1.5 rounded-full", status.tone)} aria-hidden="true" />{status.label}
                  </div>
                </div>
                <button type="button" aria-label={`${agent.name} settings`} title="Settings"
                  onClick={() => dispatch({ type: "toggleSettings", botId: agent.id, open: true })}
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary opacity-0 hover:bg-raised hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100">
                  <Settings size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    );
  }
  const page = { cloudProjectId: cloudProjectId ?? null, projectName: bot.name };
  if (section === "issues") {
    const assignTo = (agent: Bot) => {
      if (!assigning) return;
      dispatch({ type: "send", botId: agent.id, text: issueBrief(assigning) });
      setAssigning(null);
      openBot(dispatch, agent, showThreads);
    };
    return (
      <>
        <IssuesPage {...page} onAssignToAgent={setAssigning} />
        {assigning && <AssignIssueDialog issue={assigning} agents={[bot, ...teamAgents(state.bots, bot)]} onPick={assignTo} onClose={() => setAssigning(null)} />}
      </>
    );
  }
  if (section === "assets") return <AssetsPage {...page} />;
  if (section === "vault") return <VaultPage {...page} />;
  if (section === "repo") return <RepoPage {...page} />;
  if (section === "feedback") return <FeedbackPage {...page} />;
  if (section === "team-chat") return <TeamChatPage {...page} />;
  if (section === "call") return <CallPage {...page} />;
  if (section === "settings") return <ProjectSettingsPage {...page} />;
  const Icon = entry.icon;
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" aria-label={entry.label}>
      <Icon size={28} className="text-ink-secondary" aria-hidden="true" />
      <h2 className="text-[17px] font-semibold text-ink">{entry.label}</h2>
      <p className="max-w-sm text-[13px] text-ink-secondary">{entry.blurb}</p>
      <span className="rounded-full bg-raised px-3 py-1 text-[12px] text-ink-secondary">Coming soon</span>
    </section>
  );
}

/** A slim bar over a project agent's chat that leads back to its project. */
export function AgentProjectBar({ agent }: { agent: Bot }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const team = agent.section?.trim();
  const chief = !agent.chiefOfStaff && team ? state.bots.find((bot) => bot.chiefOfStaff && bot.section?.trim() === team) : undefined;
  if (!chief) return null;
  return (
    <div data-agent-project-bar className="flex shrink-0 items-center gap-2 border-b border-hairline/40 px-4 py-2 pl-11 text-[13px] md:pl-4">
      <button type="button" onClick={() => { setChiefSectionOf(chief.id, "agents"); openBot(dispatch, chief, showThreads); }}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-ink-secondary hover:bg-raised hover:text-ink">
        <ArrowLeft size={14} aria-hidden="true" /><BotAvatar bot={chief} size={18} /><span className="font-medium">{chief.name}</span>
      </button>
      <span className="text-ink-tertiary">/</span>
      <span className="truncate font-semibold text-ink">{agent.name}</span>
      {agent.title && <span className="truncate text-ink-secondary">· {agent.title}</span>}
    </div>
  );
}
