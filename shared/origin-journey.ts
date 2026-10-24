/** The phases a project moves through, from idea to sale. */
export const JOURNEY_PHASES = ["plan", "build", "launch", "sell"] as const;
export type JourneyPhase = (typeof JOURNEY_PHASES)[number];
export const JOURNEY_PHASE_LABEL: Record<JourneyPhase, string> = { plan: "Plan", build: "Build", launch: "Launch", sell: "Sell" };

/** `pulse:journey`: what a project has made so far, read for its next step. */
export interface JourneyFacts {
  name: string;
  brief: boolean;
  docs: number;
  drafts: number;
  issuesOpen: number;
  issuesDone: number;
  /** A release is published. */
  shipped: boolean;
}

export type JourneyStepId = "brief" | "issues" | "build" | "ship" | "feedback";
export type JourneySection = "docs" | "issues" | "ship" | "feedback";

export interface JourneyStep {
  id: JourneyStepId;
  phase: JourneyPhase;
  title: string;
  detail: string;
  section: JourneySection;
  action: string;
  /** What the project's Chief is asked to do when the person hands it this step. */
  brief: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function stepId(facts: JourneyFacts): JourneyStepId {
  if (facts.shipped) return "feedback";
  if (facts.issuesOpen === 0 && facts.issuesDone > 0) return "ship";
  if (facts.issuesOpen > 0) return "build";
  return facts.brief ? "issues" : "brief";
}

/** The one step that moves the project on: the furthest thing it has made decides it. */
export function nextJourneyStep(facts: JourneyFacts): JourneyStep {
  const { name } = facts;
  switch (stepId(facts)) {
    case "brief": return {
      id: "brief", phase: "plan", section: "docs", action: "Open Docs",
      title: "Write the Brief", detail: "Problem, audience, core features and the success metric.",
      brief: `Draft the Brief for ${name} in Docs: problem, audience, core features and success metric. Ask me what you need to know first.`,
    };
    case "issues": return {
      id: "issues", phase: "plan", section: "issues", action: "Open Issues",
      title: "Brief ready → plan the MVP issues",
      detail: facts.drafts ? `${plural(facts.drafts, "Draft issue waits", "Draft issues wait")} to be moved onto the board.` : "Break the Brief into issues the team can take.",
      brief: `Break the Brief of ${name} into MVP issues, each with what done looks like, and tell me which agent should take each one.`,
    };
    case "build": return {
      id: "build", phase: "build", section: "issues", action: "Open Issues",
      title: `Build the MVP · ${plural(facts.issuesOpen, "issue", "issues")} open`, detail: "Hand issues to agents, or take one yourself.",
      brief: `Drive the ${plural(facts.issuesOpen, "open issue", "open issues")} of ${name} to done: assign each to the agent whose role fits, follow up, and tell me what blocks them.`,
    };
    case "ship": return {
      id: "ship", phase: "build", section: "ship", action: "Open Ship",
      title: "MVP issues done → Ship", detail: "Release what the team merged and deploy it.",
      brief: `The MVP issues of ${name} are done. Prepare a release in Ship with notes from the merged pull requests, ready for my approval.`,
    };
    case "feedback": return {
      id: "feedback", phase: "launch", section: "feedback", action: "Open Feedback",
      title: "Shipped → learn from feedback", detail: "Read what people say about the release and plan the next issues.",
      brief: `${name} is shipped. Go through its Feedback, group what people ask for, and propose the next issues for my approval.`,
    };
  }
}

/** Which phases the project has finished: every phase before the next step's. */
export function phasesDone(step: Pick<JourneyStep, "phase">): Record<JourneyPhase, boolean> {
  const at = JOURNEY_PHASES.indexOf(step.phase);
  return { plan: at > 0, build: at > 1, launch: at > 2, sell: false };
}

/** One line for an agent's turn context: where the project stands and the step it should push. */
export function journeyContextLine(facts: JourneyFacts): string {
  const step = nextJourneyStep(facts);
  const made = [
    facts.brief ? "Brief written" : "no Brief",
    `${facts.issuesOpen} open / ${facts.issuesDone} done issues${facts.drafts ? ` (${facts.drafts} in Draft)` : ""}`,
    facts.shipped ? "shipped" : "not shipped",
  ].join(", ");
  return `- Journey (Plan → Build → Launch → Sell): ${facts.name} is in ${JOURNEY_PHASE_LABEL[step.phase]}; ${made}. Next step: ${step.title}. ${step.detail} Steer plans and suggestions toward it unless the person asks for something else.`;
}
