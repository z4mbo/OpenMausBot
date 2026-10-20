import type { IntegrationStatus } from "../../shared/integration-keys";

export type StackStepId = "github" | "studio" | "social";

export interface StackStep {
  id: StackStepId;
  title: string;
  /** What connecting it unlocks, in a few words. */
  unlocks: string;
  /** Integration ids that satisfy the step; any one connected completes it. GitHub has none: it is the workspace connection. */
  providers: readonly string[];
}

/** The services a workspace connects to go from idea to launch, in the order the journey reaches them. */
export const STACK: readonly StackStep[] = [
  { id: "github", title: "GitHub", unlocks: "Repositories, issues and pushes for every member", providers: [] },
  { id: "studio", title: "Studio generation", unlocks: "Images, video and voice", providers: ["fal", "openai", "elevenlabs"] },
  { id: "social", title: "Social accounts", unlocks: "Posts and reels from Broadcast", providers: ["x", "bluesky", "linkedin", "meta", "tiktok"] },
];

export type StepState = "done" | "partial" | "todo";

export type GitHubState = { connected: boolean; shared: boolean } | null;

export function stepState(step: StackStep, integrations: readonly IntegrationStatus[], github: GitHubState): StepState {
  if (step.id === "github") return github?.shared ? "done" : github?.connected ? "partial" : "todo";
  const mine = integrations.filter((integration) => step.providers.includes(integration.id));
  if (mine.some((integration) => integration.configured)) return "done";
  return mine.some((integration) => integration.fields.some((field) => field.set)) ? "partial" : "todo";
}

/** Who provides a connected service: this person's own key, or one an admin shared. */
export function providerSource(integration: IntegrationStatus): "yours" | "shared" | "incomplete" | "none" {
  if (integration.source) return integration.source;
  return integration.fields.some((field) => field.set) ? "incomplete" : "none";
}

export function stackProgress(integrations: readonly IntegrationStatus[], github: GitHubState): { done: number; total: number } {
  return { done: STACK.filter((step) => stepState(step, integrations, github) === "done").length, total: STACK.length };
}
