import { useSyncExternalStore } from "react";
import { useStore } from "@/state/store";
import { openBot } from "@/state/thread-navigation";
import { useCloudLinks } from "./origin-cloud-links";
import { setChiefSectionOf } from "./origin-chief-section";
import { openOriginPage } from "./origin-pages";
import { useShowThreads } from "./thread-preferences";

/** The issue an Issues board should open once it shows its project. */
export interface IssueFocus {
  projectId: string;
  issueId: string;
}

let focus: IssueFocus | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function requestIssueFocus(next: IssueFocus): void {
  focus = next;
  notify();
}

export function consumeIssueFocus(done: IssueFocus): void {
  if (focus !== done) return;
  focus = null;
  notify();
}

export function useIssueFocus(projectId: string | null): IssueFocus | null {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => focus, () => null);
  return current && current.projectId === projectId ? current : null;
}

/** The project bot linked to a cloud project, which shows that project's sections in this app. */
export function projectBotFor(projects: Record<string, string>, bots: readonly { id: string; hidden?: boolean }[], projectId: string): string | null {
  const linked = new Set(Object.entries(projects).filter(([, cloudId]) => cloudId === projectId).map(([botId]) => botId));
  return bots.find((bot) => linked.has(bot.id) && !bot.hidden)?.id ?? null;
}

/** Opens an Origin issue in its project's Issues section; false when no bot in this app shows that project. */
export function useOpenOriginIssue(): (issue: IssueFocus) => boolean {
  const { state, dispatch } = useStore();
  const { projects } = useCloudLinks();
  const showThreads = useShowThreads();
  return (issue) => {
    const botId = projectBotFor(projects, state.bots, issue.projectId);
    const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
    if (!bot) return false;
    requestIssueFocus(issue);
    setChiefSectionOf(bot.id, "issues");
    openOriginPage(null);
    openBot(dispatch, bot, showThreads);
    return true;
  };
}

export function useCanOpenOriginProject(projectId: string): boolean {
  const { state } = useStore();
  const { projects } = useCloudLinks();
  return projectBotFor(projects, state.bots, projectId) !== null;
}
