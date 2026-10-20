import { useState, useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { chiefSectionOf, chiefSectionsVersion, setChiefSectionOf, subscribeChiefSections, type ChiefSection } from "@/lib/origin-chief-section";
export type { ChiefSection };
import { openBot } from "@/state/thread-navigation";
import { useShowThreads } from "@/lib/thread-preferences";
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
import { ChiefSectionBar } from "./ProjectSectionBar";
import { sectionEntry, teamAgents } from "./project-sections";

export { ChiefSectionBar };
export { CHIEF_SECTIONS, teamAgents, teamUnread } from "./project-sections";

export function useChiefSection(botId: string): [ChiefSection, (section: ChiefSection) => void] {
  useSyncExternalStore(subscribeChiefSections, chiefSectionsVersion, chiefSectionsVersion);
  return [chiefSectionOf(botId), (next) => setChiefSectionOf(botId, next)];
}

/** A section page under the project bar: the bar and the page's own header share one glass and the page scrolls beneath both, as the chat does. */
export function ChiefSectionFrame({ bot, section, onSection }: { bot: Bot; section: Exclude<ChiefSection, "chat">; onSection(section: ChiefSection): void }) {
  return (
    <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25] pb-1.5"
      bar={<ChiefSectionBar bot={bot} section={section} onSection={onSection} joined />}>
      <div key={section} data-section-page={section} className="flex min-h-0 min-w-0 flex-1 flex-col motion-safe:animate-[section-in_var(--motion-base)_var(--ease-out)_backwards]">
        <ChiefSectionPanel bot={bot} section={section} />
      </div>
    </GlassHeaderFrame>
  );
}

export function ChiefSectionPanel({ bot, section }: { bot: Bot; section: Exclude<ChiefSection, "chat"> }) {
  const { state, dispatch } = useStore();
  const cloudProjectId = useCloudProjectFor(bot);
  const cloudTeamId = useCloudWorkspaceFor(bot);
  const showThreads = useShowThreads();
  const [assigning, setAssigning] = useState<AssignableIssue | null>(null);
  const [launching, setLaunching] = useState(false);
  const entry = sectionEntry(section);
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
        }} chief={{ name: bot.name, implement: (issue) => dispatch({ type: "send", botId: bot.id, text: implementBrief(issue) }), openCanvas: () => setChiefSectionOf(bot.id, "draw") }} onLaunch={() => setLaunching(true)} />
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
