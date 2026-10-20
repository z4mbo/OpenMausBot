import { useCallback, useSyncExternalStore } from "react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { nextJourneyStep, type JourneyFacts, type JourneySection, type JourneyStep, type JourneyStepId } from "../../shared/origin-journey";

export type { JourneyFacts, JourneyStep };

export interface ProjectJourney { facts: JourneyFacts; step: JourneyStep }

export function useProjectJourney(projectId: string | null | undefined): ProjectJourney | undefined {
  const facts = useCloudQuery<JourneyFacts>("pulse:journey", projectId ? { projectId } : "skip");
  return facts ? { facts, step: nextJourneyStep(facts) } : undefined;
}

/** The section whose work, once done, leads to each step: that section points on to the step. */
const STEP_ORIGIN: Partial<Record<JourneyStepId, JourneySection>> = { sketch: "docs", issues: "draw", ship: "issues", content: "ship", post: "studio", sell: "broadcast" };

export const stepOrigin = (step: Pick<JourneyStep, "id">): JourneySection | undefined => STEP_ORIGIN[step.id];

const DISMISSED_KEY = "origin.journey.dismissed";
const listeners = new Set<() => void>();
let dismissed: Record<string, JourneyStepId> = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "{}") as unknown;
    return stored && typeof stored === "object" ? stored as Record<string, JourneyStepId> : {};
  } catch {
    return {};
  }
})();

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Whether the person hid this project's current step; a new step shows again. */
export function useStepDismissed(projectId: string | null | undefined, step: JourneyStepId | undefined): [boolean, () => void] {
  const hidden = useSyncExternalStore(subscribe, () => Boolean(projectId && step && dismissed[projectId] === step));
  const dismiss = useCallback(() => {
    if (!projectId || !step) return;
    dismissed = { ...dismissed, [projectId]: step };
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed)); } catch { /* a private window can refuse storage */ }
    for (const listener of listeners) listener();
  }, [projectId, step]);
  return [hidden, dismiss];
}
