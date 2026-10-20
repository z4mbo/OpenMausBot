import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Activity, ArrowLeft, Bot as BotIcon, Brush, ChevronDown, CircleDot, FileText, GitBranch, Headset, Images, LockKeyhole, Megaphone, MessageCircle, Rocket, Send, Settings, Sparkles, Target, type LucideIcon } from "lucide-react";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import { UnreadBadge } from "./UnreadBadge";
import { SidebarPopoverMenu } from "./SidebarPopoverMenu";
import { sectionsThatFit } from "@/lib/section-overflow";
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
import { handOff as handIssueTo } from "@/lib/origin-handoff";
import { StudioPage } from "./origin-studio/StudioPage";
import { BroadcastPage } from "./origin-broadcast/BroadcastPage";
import { PipelinePage } from "./origin-pipeline/PipelinePage";
import { ShipPage } from "./origin-ship/ShipPage";
import { DocsPage } from "./origin-docs/DocsPage";
import { LaunchpadDialog } from "./origin-launchpad/LaunchpadDialog";
import { setMilestoneFilter } from "@/lib/origin-milestone-filter";
import { PulsePage } from "./origin-pulse/PulsePage";

export const CHIEF_SECTIONS = [
  { id: "pulse", label: "Pulse", icon: Activity, blurb: "The project at a glance, from idea to growth.", place: "tab" },
  { id: "agents", label: "Agents", icon: BotIcon, blurb: "", place: "tab" },
  { id: "issues", label: "Issues", icon: CircleDot, blurb: "Track the project's bugs and tasks, and hand them to its agents.", place: "tab" },
  { id: "docs", label: "Docs", icon: FileText, blurb: "The project's Brief and specs, written by people and agents.", place: "tab" },
  { id: "team-chat", label: "Chat", icon: MessageCircle, blurb: "Talk with the people in this project.", place: "tab" },
  { id: "call", label: "Call", icon: Headset, blurb: "Voice and video calls with the people in this project.", place: "tab" },
  { id: "draw", label: "Canvas", icon: Brush, blurb: "Shared design canvases the people and agents in this project build on.", place: "tab" },
  { id: "ship", label: "Ship", icon: Rocket, blurb: "Deploy the project and release what the team merged.", place: "tab" },
  { id: "studio", label: "Studio", icon: Sparkles, blurb: "Generate images, video and audio for this project.", place: "tab" },
  { id: "broadcast", label: "Broadcast", icon: Send, blurb: "Plan and publish this project's posts on social channels.", place: "tab" },
  { id: "pipeline", label: "Pipeline", icon: Target, blurb: "Leads and sales: see them, reach them, and plan how to win them.", place: "tab" },
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

const SECTION_TABS = CHIEF_SECTIONS.filter((item) => item.place === "tab");
const TAB_GAP = 2;
const tabClass = "relative flex h-9 shrink-0 items-center gap-2 rounded-xl px-2.5 text-[13.5px] font-medium outline-none transition-colors duration-(--motion-fast) focus-visible:ring-1 focus-visible:ring-accent/60";

/** Slides one highlight under whichever tab, or More trigger, is current instead of swapping backgrounds. */
function useTabHighlight(strip: RefObject<HTMLDivElement | null>, current: string, layout: number) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelector<HTMLElement>("[data-current]");
      if (!tab) return setBox(null);
      const rect = tab.getBoundingClientRect();
      setBox({ left: rect.left - root.getBoundingClientRect().left, width: rect.width });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    return () => resize.disconnect();
  }, [strip, current, layout]);
  return box;
}

/** How many tabs fit in the strip; the rest wait behind More. */
function useVisibleTabs(strip: RefObject<HTMLDivElement | null>, current: number) {
  const ruler = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<number>(SECTION_TABS.length);
  useLayoutEffect(() => {
    const root = strip.current, measures = ruler.current;
    if (!root || !measures) return;
    const fit = () => {
      const widths = [...measures.children].map((child) => child.getBoundingClientRect().width);
      const more = widths.pop() ?? 0, moreChevron = widths.pop() ?? 0;
      setVisible(sectionsThatFit({ tabs: widths, more, moreChevron, gap: TAB_GAP, available: root.clientWidth, current }));
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(root);
    resize.observe(measures);
    return () => resize.disconnect();
  }, [strip, current]);
  return { ruler, visible };
}

function TabFace({ icon: Icon, label, current, badge }: { icon: LucideIcon; label: string; current: boolean; badge?: number }) {
  return (
    <>
      <Icon size={18} aria-hidden="true" className={cn("transition-colors duration-(--motion-fast)", current && "text-accent-text")} />{label}
      {badge !== undefined && <UnreadBadge count={badge} />}
    </>
  );
}

/** `joined` sits inside a glass header; otherwise the bar wears the same glass on its own. */
export function ChiefSectionBar({ bot, section, onSection, joined = false }: { bot: Bot; section: ChiefSection; onSection(section: ChiefSection): void; joined?: boolean }) {
  const { state } = useStore();
  const agentsUnread = teamUnread(state.bots, bot);
  const currentIndex = SECTION_TABS.findIndex((item) => item.id === section);
  const strip = useRef<HTMLDivElement>(null);
  const { ruler, visible } = useVisibleTabs(strip, currentIndex);
  const box = useTabHighlight(strip, section, visible);
  const shown = SECTION_TABS.slice(0, visible);
  const hidden = SECTION_TABS.slice(visible);
  const hiddenCurrent = currentIndex >= visible ? SECTION_TABS[currentIndex] : undefined;
  const badge = (id: string) => (id === "agents" ? agentsUnread : undefined);
  return (
    <nav aria-label={`${bot.name} sections`} data-chief-sections className={cn("relative flex h-14 shrink-0 items-center gap-1 px-3 pl-11 max-md:h-auto max-md:flex-wrap max-md:py-2 md:pl-3", !joined && "glass-bar z-[25] border-b border-hairline/40 [--glass-tint:var(--color-app)]")}>
      <button type="button" onClick={() => onSection("chat")} aria-current={section === "chat" ? "page" : undefined}
        className={cn("mr-1 flex h-10 min-w-0 items-center gap-2 rounded-xl px-2 text-[14px] font-semibold text-ink outline-none transition-colors duration-(--motion-fast) hover:bg-raised/50 focus-visible:ring-1 focus-visible:ring-accent/60 max-md:flex-1 md:shrink-0", section === "chat" && "bg-raised")}>
        <BotAvatar bot={bot} size={24} />
        <span className="max-w-[160px] truncate">{bot.name}</span>
        {unreadReplies(bot) > 0
          ? <UnreadBadge count={unreadReplies(bot)} />
          : <span aria-label={bot.busy ? "Working" : "Idle"} className={cn("size-2 rounded-full", bot.busy ? "animate-pulse bg-success" : "bg-ink-tertiary/60")} />}
      </button>
      <div ref={strip} className="relative flex min-w-0 flex-1 items-center gap-0.5 max-md:order-3 max-md:-ml-8 max-md:basis-full">
        {box && <span aria-hidden="true" className="pointer-events-none absolute left-0 top-1/2 h-9 rounded-xl bg-raised transition-[translate,width] duration-(--motion-base) ease-out motion-reduce:transition-none"
          style={{ width: box.width, translate: `${box.left}px -50%` }} />}
        {shown.map(({ id, label, icon }) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} data-current={section === id || undefined} data-chief-section={id}
            onClick={() => onSection(id)}
            className={cn(tabClass, section === id ? "text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink", section === id && !box && "bg-raised")}>
            <TabFace icon={icon} label={label} current={section === id} badge={badge(id)} />
          </button>
        ))}
        {hidden.length > 0 && (
          <div className="shrink-0" data-current={hiddenCurrent ? true : undefined}>
            <SidebarPopoverMenu
              ariaLabel={hiddenCurrent ? `More sections, ${hiddenCurrent.label} open` : "More sections"}
              triggerClassName={cn(tabClass, hiddenCurrent ? "text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink", hiddenCurrent && !box && "bg-raised")}
              items={hidden.map(({ id, label, icon: Icon }) => ({ key: id, label, icon: <Icon size={18} />, active: section === id, trailing: badge(id) ? <UnreadBadge count={badge(id)!} /> : undefined, onSelect: () => onSection(id) }))}
              renderTrigger={({ open }) => (
                <>
                  {hiddenCurrent ? <TabFace icon={hiddenCurrent.icon} label={hiddenCurrent.label} current /> : "More"}
                  <ChevronDown size={14} aria-hidden="true" className={cn("-ml-1 text-ink-tertiary transition-transform duration-(--motion-fast)", open && "rotate-180")} />
                </>
              )} />
          </div>
        )}
      </div>
      <div ref={ruler} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max overflow-hidden">
        {SECTION_TABS.map(({ id, label, icon }) => <span key={id} className={tabClass}><TabFace icon={icon} label={label} current={false} badge={badge(id)} /></span>)}
        <span className={cn(tabClass, "gap-0 px-0")}><ChevronDown size={14} className="-ml-1" /></span>
        <span className={tabClass}>More<ChevronDown size={14} className="-ml-1" /></span>
      </div>
      <div className="flex shrink-0 items-center max-md:order-2" role="group" aria-label="Project tools">
        {CHIEF_SECTIONS.filter((item) => item.place === "tool").map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} aria-label={label} title={label} data-chief-section={id}
            onClick={() => onSection(id)}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl outline-none transition-colors duration-(--motion-fast) focus-visible:ring-1 focus-visible:ring-accent/60 md:size-10",
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
  const [launching, setLaunching] = useState(false);
  const entry = CHIEF_SECTIONS.find((item) => item.id === section)!;
  const launchpad = launching && <LaunchpadDialog target={{ kind: "project", chief: bot, projectName: bot.name }} onClose={() => setLaunching(false)} />;
  if (section === "agents") return <ProjectAgentsPage lead={bot} agents={teamAgents(state.bots, bot)} />;
  const page = { cloudProjectId: cloudProjectId ?? null, projectName: bot.name, link: { botId: bot.id, teamId: cloudTeamId ?? null } };
  if (section === "issues") {
    const team = [bot, ...teamAgents(state.bots, bot)];
    const handOff = (issue: AssignableIssue, agent: Bot) => {
      setAssigning(null);
      handIssueTo(dispatch, agent, agent.id === bot.id ? implementBrief(issue) : issueBrief(issue), showThreads);
    };
    const agents = team.map((agent) => ({ id: agent.id, name: agent.name, avatar: <BotAvatar bot={agent} size={20} /> }));
    return (
      <>
        <IssuesPage {...page} agents={agents} onAssignToAgent={(issue, agentId) => {
          const agent = agentId ? team.find((candidate) => candidate.id === agentId) : undefined;
          if (agent) handOff(issue, agent);
          else setAssigning(issue);
        }} chief={{ name: bot.name, implement: (issue) => dispatch({ type: "send", botId: bot.id, text: implementBrief(issue) }) }} onLaunch={() => setLaunching(true)} />
        {assigning && <AssignIssueDialog issue={assigning} agents={team} onPick={(agent) => handOff(assigning, agent)} onClose={() => setAssigning(null)} />}
        {launchpad}
      </>
    );
  }
  if (section === "docs") {
    return <><DocsPage {...page} onLaunch={() => setLaunching(true)} onOpenMilestone={(milestoneId) => {
      if (cloudProjectId) setMilestoneFilter(cloudProjectId, milestoneId);
      setChiefSectionOf(bot.id, "issues");
    }} />{launchpad}</>;
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
  if (section === "studio") return <StudioPage {...page} agent={bot} />;
  if (section === "broadcast") return <BroadcastPage {...page} agent={bot} />;
  if (section === "pipeline") return <PipelinePage {...page} agent={bot} />;
  if (section === "ship") return <ShipPage {...page} agent={bot} />;
  if (section === "settings") return <ProjectSettingsPage {...page} />;
  if (section === "pulse") return <PulsePage {...page} botId={bot.id} />;
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
