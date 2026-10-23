import { useState, useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { chiefSectionOf, chiefSectionsVersion, setChiefSectionOf, subscribeChiefSections, type ChiefSection, type ShownSection } from "@/lib/origin-chief-section";
export type { ChiefSection };
import { openBot } from "@/state/thread-navigation";
import { useShowThreads } from "@/lib/thread-preferences";
import { BotAvatar } from "./Avatar";
import { AssignIssueDialog, AssetsPage, CallPage, FeedbackPage, IssuesPage, ProjectSettingsPage, RepoPage, TeamChatPage, VaultPage, implementBrief, issueBrief, type AssignableIssue } from "./origin-pages";
import { useCloudProjectFor, useCloudWorkspaceFor } from "@/lib/origin-cloud-links";
import { GlassHeaderFrame } from "./GlassScrollFrame";
import { openOriginPage } from "@/lib/origin-pages";
import { requestIssueFocus } from "@/lib/origin-issue-focus";
import { handOff as handIssueTo } from "@/lib/origin-handoff";
import { StudioPage } from "./origin-studio/StudioPage";
import { DesignPage } from "./origin-design/DesignPage";
import { BroadcastPage } from "./origin-broadcast/BroadcastPage";
import { LaunchpadDialog } from "./origin-launchpad/LaunchpadDialog";
import { ChiefSectionBar } from "./ProjectSectionBar";
import { teamAgents } from "./project-sections";

export { ChiefSectionBar };
export { CHIEF_SECTIONS, teamAgents, teamUnread } from "./project-sections";

export function useChiefSection(botId: string): [ShownSection, (section: ChiefSection) => void] {
  useSyncExternalStore(subscribeChiefSections, chiefSectionsVersion, chiefSectionsVersion);
  return [chiefSectionOf(botId), (next) => setChiefSectionOf(botId, next)];
}

/** A section page under the project bar: the bar and the page's own header share one glass and the page scrolls beneath both, as the chat does. */
export function ChiefSectionFrame({ bot, section, onSection }: { bot: Bot; section: Exclude<ShownSection, "chat">; onSection(section: ChiefSection): void }) {
  return (
    <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="glass-bar-plain z-[25] pb-1.5"
      bar={<ChiefSectionBar bot={bot} section={section} onSection={onSection} joined />}>
      <div key={`${bot.id}:${section}`} data-section-page={section} className="flex min-h-0 min-w-0 flex-1 flex-col motion-safe:animate-[section-in_var(--motion-base)_var(--ease-out)_backwards]">
        <ChiefSectionPanel bot={bot} section={section} />
      </div>
    </GlassHeaderFrame>
  );
}

export function ChiefSectionPanel({ bot, section }: { bot: Bot; section: Exclude<ShownSection, "chat"> }) {
  const { state, dispatch } = useStore();
  const cloudProjectId = useCloudProjectFor(bot);
  const cloudTeamId = useCloudWorkspaceFor(bot);
  const showThreads = useShowThreads();
  const [assigning, setAssigning] = useState<AssignableIssue | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchpad = launching && <LaunchpadDialog target={{ kind: "project", chief: bot, projectName: bot.name }} onClose={() => setLaunching(false)} />;
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
  if (section === "studio") return <StudioPage {...page} agent={bot} />;
  if (section === "design") return <DesignPage {...page} agent={bot} />;
  if (section === "broadcast") return <BroadcastPage {...page} agent={bot} />;
  return <ProjectSettingsPage {...page} />;
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
      <button type="button" onClick={() => { setChiefSectionOf(chief.id, "chat"); openBot(dispatch, chief, showThreads); }}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-ink-secondary hover:bg-raised hover:text-ink">
        <ArrowLeft size={14} aria-hidden="true" /><BotAvatar bot={chief} size={18} /><span className="font-medium">{chief.name}</span>
      </button>
      <span className="text-ink-tertiary">/</span>
      <span className="truncate font-semibold text-ink">{agent.name}</span>
      {agent.title && <span className="truncate text-ink-secondary">· {agent.title}</span>}
    </div>
  );
}
