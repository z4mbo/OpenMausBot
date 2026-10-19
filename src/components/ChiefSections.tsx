import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Bot as BotIcon, Brush, CircleDot, GitBranch, Headset, Images, LockKeyhole, Megaphone, MessageCircle, Settings } from "lucide-react";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import { UnreadBadge } from "./UnreadBadge";
import { useStore, type Bot } from "@/state/store";
import { chiefSectionOf, chiefSectionsVersion, setChiefSectionOf, subscribeChiefSections, type ChiefSection } from "@/lib/origin-chief-section";
export type { ChiefSection };
import { openBot } from "@/state/thread-navigation";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { ProjectAgentsPage } from "./ProjectAgentsPage";
import { AssignIssueDialog, AssetsPage, CallPage, FeedbackPage, IssuesPage, ProjectSettingsPage, RepoPage, TeamChatPage, VaultPage, implementBrief, issueBrief, type AssignableIssue } from "./origin-pages";
import { useCloudProjectFor, useCloudWorkspaceFor } from "@/lib/origin-cloud-links";
import { GlassHeaderFrame } from "./GlassScrollFrame";
import { openOriginPage } from "@/lib/origin-pages";
import { ProjectDrawPage } from "./OriginDraw";
import { requestIssueFocus } from "@/lib/origin-issue-focus";

export const CHIEF_SECTIONS = [
  { id: "agents", label: "Agents", icon: BotIcon, blurb: "", place: "tab" },
  { id: "issues", label: "Issues", icon: CircleDot, blurb: "Track the project's bugs and tasks, and hand them to its agents.", place: "tab" },
  { id: "team-chat", label: "Chat", icon: MessageCircle, blurb: "Talk with the people in this project.", place: "tab" },
  { id: "call", label: "Call", icon: Headset, blurb: "Voice and video calls with the people in this project.", place: "tab" },
  { id: "draw", label: "Draw", icon: Brush, blurb: "Shared canvases the people and agents in this project sketch on.", place: "tab" },
  { id: "assets", label: "Assets", icon: Images, blurb: "Images, documents and files the team makes for this project.", place: "tab" },
  { id: "vault", label: "Vault", icon: LockKeyhole, blurb: "Keys, logins and secrets this project's agents may use.", place: "tool" },
  { id: "repo", label: "Repo", icon: GitBranch, blurb: "The project's code repository and its pull requests.", place: "tool" },
  { id: "feedback", label: "Feedback", icon: Megaphone, blurb: "What users say about the project, collected in one place.", place: "tool" },
  { id: "settings", label: "Settings", icon: Settings, blurb: "Settings for the whole project: its name, members, integrations and defaults for its agents.", place: "tool" },
] as const;


export function useChiefSection(botId: string): [ChiefSection, (section: ChiefSection) => void] {
  useSyncExternalStore(subscribeChiefSections, chiefSectionsVersion, chiefSectionsVersion);
  return [chiefSectionOf(botId), (next) => setChiefSectionOf(botId, next)];
}

export function teamAgents(bots: readonly Bot[], chief: Bot): Bot[] {
  const team = chief.section?.trim();
  return team ? bots.filter((bot) => !bot.hidden && bot.id !== chief.id && bot.section?.trim() === team) : [];
}

/** Unread replies across a project's agents, which the sidebar does not list one by one. */
export function teamUnread(bots: readonly Bot[], chief: Bot): number {
  return teamAgents(bots, chief).filter((agent) => botShowsUnread(agent)).reduce((sum, agent) => sum + unreadReplies(agent), 0);
}

/** A section page under the project bar: the bar and the page's own header share one glass and the page scrolls beneath both, as the chat does. */
export function ChiefSectionFrame({ bot, section, onSection }: { bot: Bot; section: Exclude<ChiefSection, "chat">; onSection(section: ChiefSection): void }) {
  return (
    <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25] pb-1.5"
      bar={<ChiefSectionBar bot={bot} section={section} onSection={onSection} joined />}>
      <ChiefSectionPanel key={section} bot={bot} section={section} />
    </GlassHeaderFrame>
  );
}

/** Slides one highlight under whichever tab is current instead of swapping backgrounds. */
function useTabHighlight(current: string) {
  const strip = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelector<HTMLElement>('[aria-current="page"]');
      setBox(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null);
    };
    measure();
    root.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    return () => resize.disconnect();
  }, [current]);
  return { strip, box };
}

/** `joined` sits inside a glass header; otherwise the bar wears the same glass on its own. */
export function ChiefSectionBar({ bot, section, onSection, joined = false }: { bot: Bot; section: ChiefSection; onSection(section: ChiefSection): void; joined?: boolean }) {
  const { state } = useStore();
  const agentsUnread = teamUnread(state.bots, bot);
  const { strip, box } = useTabHighlight(section);
  return (
    <nav aria-label={`${bot.name} sections`} data-chief-sections className={cn("flex h-14 shrink-0 items-center gap-1 px-3 pl-11 max-md:h-auto max-md:flex-wrap max-md:py-2 md:pl-3", !joined && "glass-bar relative z-[25] border-b border-hairline/40 [--glass-tint:var(--color-app)]")}>
      <button type="button" onClick={() => onSection("chat")} aria-current={section === "chat" ? "page" : undefined}
        className={cn("mr-1 flex h-10 min-w-0 items-center gap-2 rounded-xl px-2 text-[14px] font-semibold text-ink outline-none transition-colors hover:bg-raised/50 focus-visible:ring-1 focus-visible:ring-accent/60 max-md:flex-1 md:shrink-0", section === "chat" && "bg-raised")}>
        <BotAvatar bot={bot} size={24} />
        <span className="max-w-[160px] truncate">{bot.name}</span>
        {unreadReplies(bot) > 0
          ? <UnreadBadge count={unreadReplies(bot)} />
          : <span aria-label={bot.busy ? "Working" : "Idle"} className={cn("size-2 rounded-full", bot.busy ? "animate-pulse bg-success" : "bg-ink-tertiary/60")} />}
      </button>
      <div ref={strip} className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] max-md:order-3 max-md:basis-full max-md:pr-4 max-md:[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
        {box && <span aria-hidden="true" className="pointer-events-none absolute inset-y-auto left-0 h-9 rounded-xl bg-raised transition-[transform,width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: box.width, transform: `translateX(${box.left}px)` }} />}
        {CHIEF_SECTIONS.filter((item) => item.place === "tab").map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} data-chief-section={id}
            onClick={() => onSection(id)}
            className={cn("relative flex h-9 shrink-0 items-center gap-2 rounded-xl px-2.5 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent/60",
              section === id ? "text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink", section === id && !box && "bg-raised")}>
            <Icon size={18} aria-hidden="true" className={cn("transition-colors duration-150", section === id && "text-accent-text")} />{label}
            {id === "agents" && <UnreadBadge count={agentsUnread} />}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center max-md:order-2" role="group" aria-label="Project tools">
        {CHIEF_SECTIONS.filter((item) => item.place === "tool").map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} aria-label={label} title={label} data-chief-section={id}
            onClick={() => onSection(id)}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl outline-none md:size-10 transition-colors focus-visible:ring-1 focus-visible:ring-accent/60",
              section === id ? "bg-raised text-accent-text" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
            <Icon size={20} aria-hidden="true" />
          </button>
        ))}
      </div>
    </nav>
  );
}

export function ChiefSectionPanel({ bot, section }: { bot: Bot; section: Exclude<ChiefSection, "chat"> }) {
  const { state, dispatch } = useStore();
  const cloudProjectId = useCloudProjectFor(bot);
  const cloudTeamId = useCloudWorkspaceFor(bot);
  const showThreads = useShowThreads();
  const [assigning, setAssigning] = useState<AssignableIssue | null>(null);
  const entry = CHIEF_SECTIONS.find((item) => item.id === section)!;
  if (section === "agents") return <ProjectAgentsPage lead={bot} agents={teamAgents(state.bots, bot)} />;
  const page = { cloudProjectId: cloudProjectId ?? null, projectName: bot.name, link: { botId: bot.id, teamId: cloudTeamId ?? null } };
  if (section === "issues") {
    const team = [bot, ...teamAgents(state.bots, bot)];
    const handOff = (issue: AssignableIssue, agent: Bot) => {
      dispatch({ type: "send", botId: agent.id, text: agent.id === bot.id ? implementBrief(issue) : issueBrief(issue) });
      setAssigning(null);
      openBot(dispatch, agent, showThreads);
    };
    const agents = team.map((agent) => ({ id: agent.id, name: agent.name, avatar: <BotAvatar bot={agent} size={20} /> }));
    return (
      <>
        <IssuesPage {...page} agents={agents} onAssignToAgent={(issue, agentId) => {
          const agent = agentId ? team.find((candidate) => candidate.id === agentId) : undefined;
          if (agent) handOff(issue, agent);
          else setAssigning(issue);
        }} chief={{ name: bot.name, implement: (issue) => dispatch({ type: "send", botId: bot.id, text: implementBrief(issue) }) }} />
        {assigning && <AssignIssueDialog issue={assigning} agents={team} onPick={(agent) => handOff(assigning, agent)} onClose={() => setAssigning(null)} />}
      </>
    );
  }
  if (section === "assets") return <AssetsPage {...page} />;
  if (section === "vault") return <VaultPage {...page} />;
  if (section === "repo") return <RepoPage {...page} onOpenSettings={() => setChiefSectionOf(bot.id, "settings")} />;
  if (section === "feedback") {
    return <FeedbackPage {...page} onOpenIssue={(taskId) => {
      if (cloudProjectId) requestIssueFocus({ projectId: cloudProjectId, issueId: taskId });
      setChiefSectionOf(bot.id, "issues");
    }} />;
  }
  if (section === "team-chat") return <TeamChatPage {...page} />;
  if (section === "call") return <CallPage {...page} agent={bot} open={() => { setChiefSectionOf(bot.id, "call"); openOriginPage(null); openBot(dispatch, bot, showThreads); }} />;
  if (section === "draw") return <ProjectDrawPage {...page} agent={bot} />;
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
