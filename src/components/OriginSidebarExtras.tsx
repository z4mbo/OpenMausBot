import { useEffect } from "react";
import { BotAvatar } from "./Avatar";
import { NewIssueComposer, type ComposerProject } from "./origin-pages/NewIssueComposer";
import { PresenceStack } from "./OriginPeople";
import { ProjectRowTrailing } from "./SidebarProjects";
import { useOriginMe } from "./OriginAccountMenu";
import { teamAgents, teamUnread } from "./ChiefSections";
import { issueBrief } from "./origin-pages";
import { createdToAssignable } from "./origin-pages/IssuesPage";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import { cloudProjectOf, useCloudLinks } from "@/lib/origin-cloud-links";
import { useCloudSession } from "@/lib/origin-cloud";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { closeNewIssue, useNewIssueRequest } from "@/lib/origin-new-issue";
import { openOriginPage, useOriginPage } from "@/lib/origin-pages";
import {
  archivedSectionsOf, canManageProject, setArchivedSections, setProjectStatus, useArchivedSections, useOriginProjects, useProjectPresence, viewersByProject,
  type ProjectViewer,
} from "@/lib/origin-project-state";
import type { ProjectArchiveControl } from "./Sidebar";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot } from "@/state/thread-navigation";
import { useStore, type Bot } from "@/state/store";

const AVATAR_PX = 18;
const AVATAR_OVERLAP = 5;
const BADGE_PX = 22;
const GAP_PX = 6;
const EDGE_PX = 14;

function trailingWidth(viewers: number, unread: boolean): number {
  const shown = Math.min(viewers, 3);
  const stack = shown ? shown * AVATAR_PX - (shown - 1) * AVATAR_OVERLAP : 0;
  return EDGE_PX + stack + (unread ? BADGE_PX : 0) + (stack && unread ? GAP_PX : 0);
}

/** Origin's live state for the sidebar's project rows: which projects are archived, who is in each, and the split avatar/name targets. */
export function useOriginProjectRows(teamId: string | null) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { projects: links } = useCloudLinks();
  const page = useOriginPage();
  const me = useOriginMe();
  const { rows, status } = useOriginProjects(teamId);
  const archived = useArchivedSections();

  const chiefs = state.bots.filter((bot) => bot.chiefOfStaff);
  const nextArchived = archivedSectionsOf(chiefs, links, status);
  const archivedKey = [...nextArchived].sort().join("\n");
  useEffect(() => { setArchivedSections(new Set(archivedKey ? archivedKey.split("\n") : [])); }, [archivedKey]);

  const here = state.activeView === "chat" && !page && state.selectedId ? cloudProjectOf(state.bots, links, state.selectedId) ?? null : null;
  const inTeam = here && rows?.some((row) => row._id === here) ? here : null;
  const others = useProjectPresence(teamId, inTeam);
  const self: ProjectViewer | null = me && inTeam
    ? { userId: me._id, projectId: inTeam, name: me.name ?? "", email: me.email, username: me.username, avatarUrl: me.avatarUrl ?? null, updatedAt: 0, self: true }
    : null;
  const viewers = viewersByProject(others, self);
  const byId = new Map((rows ?? []).map((row) => [row._id, row]));

  const isArchived = (bot: Bot) => Boolean(bot.section?.trim() && archived.has(bot.section.trim()));
  const open = (bot: Bot, section: "chat" | "issues") => {
    setChiefSectionOf(bot.id, section);
    openOriginPage(null);
    openBot(dispatch, bot, showThreads);
  };

  const rowProps = (bot: Bot) => {
    const cloudId = links[bot.id];
    const shelved = isArchived(bot);
    const present = cloudId ? viewers.get(cloudId) ?? [] : [];
    const unread = shelved ? 0 : (botShowsUnread(bot) ? unreadReplies(bot) : 0) + teamUnread(state.bots, bot);
    return {
      muteUnread: shelved,
      trailingWidth: trailingWidth(present.length, unread > 0),
      split: {
        avatarLabel: `Chat with ${bot.name}`,
        onAvatar: () => open(bot, "chat"),
        titleLabel: `${bot.name} issues`,
        onTitle: () => open(bot, "issues"),
      },
      trailing: <ProjectRowTrailing viewers={<PresenceStack viewers={present} max={3} />} unread={unread} />,
    };
  };

  const projectArchive = (botId: string): ProjectArchiveControl | undefined => {
    const cloudId = links[botId];
    const row = cloudId ? byId.get(cloudId) : undefined;
    if (!row) return undefined;
    const shelved = row.status === "inactive";
    return {
      archived: shelved,
      allowed: canManageProject(row),
      toggle: () => {
        setProjectStatus(row._id, shelved ? "active" : "inactive")
          .catch((cause: unknown) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
      },
    };
  };

  return { isArchived, rowProps, projectArchive };
}

/** Hosts the new-issue composer the sidebar's compose button opens. */
export function NewIssueHost({ teamId }: { teamId: string | null }) {
  const request = useNewIssueRequest();
  if (!request) return null;
  return <NewIssueDialog key={request.nonce} teamId={teamId} projectId={request.projectId} />;
}

function NewIssueDialog({ teamId, projectId }: { teamId: string | null; projectId: string | null }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { projects: links } = useCloudLinks();
  const me = useOriginMe();
  const { rows } = useOriginProjects(teamId);
  const session = useCloudSession();
  const signedIn = Boolean(session.user && session.token);
  const emptyNote = !session.ready ? undefined : !signedIn ? "Sign in to Origin to create issues." : !teamId ? "Share this workspace to create issues with your team." : undefined;
  const chiefFor = (cloudId: string) => state.bots.find((bot) => bot.chiefOfStaff && links[bot.id] === cloudId);
  const teamFor = (cloudId: string): Bot[] => {
    const chief = chiefFor(cloudId);
    return chief ? [chief, ...teamAgents(state.bots, chief)] : [];
  };
  const projects: ComposerProject[] = (rows ?? []).filter((row) => row.status === "active" || row._id === projectId).map((row) => {
    const chief = chiefFor(row._id);
    return { id: row._id, name: row.name, memberRole: row.memberRole, icon: chief ? <BotAvatar bot={chief} size={18} animated={false} /> : undefined };
  });
  return (
    <NewIssueComposer loading={!session.ready || (signedIn && Boolean(teamId) && rows === undefined)} emptyNote={emptyNote} projects={projects} initialProjectId={projectId} myEmail={me?.email} onClose={closeNewIssue}
      agentsFor={(cloudId) => teamFor(cloudId).map((agent) => ({ id: agent.id, name: agent.name, avatar: <BotAvatar bot={agent} size={20} animated={false} /> }))}
      onCreated={(cloudId, _taskId, issue) => {
        closeNewIssue();
        const agent = issue.agentId ? teamFor(cloudId).find((candidate) => candidate.id === issue.agentId) : undefined;
        if (agent) {
          dispatch({ type: "send", botId: agent.id, text: issueBrief(createdToAssignable(issue, rows?.find((row) => row._id === cloudId)?.name ?? "")) });
          if (agent.chiefOfStaff) setChiefSectionOf(agent.id, "chat");
          openOriginPage(null);
          openBot(dispatch, agent, showThreads);
          return;
        }
        const chief = chiefFor(cloudId);
        if (!chief) return;
        setChiefSectionOf(chief.id, "issues");
        openOriginPage(null);
        openBot(dispatch, chief, showThreads);
      }} />
  );
}
