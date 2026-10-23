import { useSyncExternalStore } from "react";
import { useStore } from "@/state/store";
import { openBot } from "@/state/thread-navigation";
import { useCloudLinks } from "./origin-cloud-links";
import { setChiefSectionOf } from "./origin-chief-section";
import { projectBotFor } from "./origin-issue-focus";
import { openOriginPage } from "./origin-pages";
import { useShowThreads } from "./thread-preferences";

/** What Studio should show once it opens its project: a preset or template set up in the prompt bar, a result in the viewer, or a workflow run. */
export interface StudioFocus {
  projectId: string;
  presetId?: string;
  templateId?: string;
  generationId?: string;
  runId?: string;
}

let focus: StudioFocus | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function consumeStudioFocus(done: StudioFocus): void {
  if (focus !== done) return;
  focus = null;
  notify();
}

export function useStudioFocus(projectId: string | null): StudioFocus | null {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => focus, () => null);
  return current && current.projectId === projectId ? current : null;
}

/** Opens a cloud project's Studio; false when no bot in this app shows that project. */
export function useOpenOriginStudio(): (next: StudioFocus) => boolean {
  const { state, dispatch } = useStore();
  const { projects } = useCloudLinks();
  const showThreads = useShowThreads();
  return (next) => {
    const botId = projectBotFor(projects, state.bots, next.projectId);
    const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
    if (!bot) return false;
    focus = next;
    notify();
    setChiefSectionOf(bot.id, "studio");
    openOriginPage(null);
    openBot(dispatch, bot, showThreads);
    return true;
  };
}
