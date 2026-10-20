import { formatLeadValue } from "../shared/origin-pipeline.ts";
import { PULSE_STAGES, PULSE_STAGE_LABEL, attentionLabel, formatHours, formatUsd, pulseDelta, type ProjectPulse, type PulseCount, type PulseRange } from "../shared/origin-pulse.ts";

type Args = Record<string, unknown>;

/** One project the pulse tool reads, already checked to be one the calling agent reaches. */
export interface PulseToolScope {
  client: { query(name: string, args: Args): Promise<unknown> };
  sessionToken: string;
  projectId: string;
  projectName: string;
}

const PROJECTS_MAX = 8;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const n = (value: number) => value.toLocaleString("en-US");

function counted(count: PulseCount): string {
  const delta = pulseDelta(count);
  return `${n(count.value)}${delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${delta}% vs the range before)`}`;
}

export function pulseText(pulse: ProjectPulse): string {
  const { build, launch, grow, team } = pulse;
  const money = (value: number) => formatLeadValue(value, grow.currency).replace(/ /g, " ");
  const stages = PULSE_STAGES.map((stage) => `${PULSE_STAGE_LABEL[stage]}${stage === pulse.stage ? " (current)" : pulse.reached[stage] ? " (reached)" : ""}`).join(" → ");
  const funnel = grow.stages.filter((row) => row.count > 0).map((row) => `${row.stage} ${n(row.count)}${row.value ? ` (${money(row.value)})` : ""}`).join(", ");
  const engaged = launch.engagement.likes + launch.engagement.reposts + launch.engagement.replies;
  return [
    `${pulse.name}, last ${pulse.range} days (UTC):`,
    `Stage: ${stages}. Ideas in Draft: ${n(pulse.idea.ideas)}.`,
    `Build: ${counted(build.done)} issues done, ${counted(build.opened)} opened, ${n(build.open)} open now, median cycle time ${formatHours(build.cycleHours)}; ${n(build.prsWaiting)} PRs waiting for a person (${n(build.prsApproved)} approved).`,
    `Launch: ${n(launch.pagesLive)} pages live, ${counted(launch.views)} page views (${n(launch.viewsTotal)} all time), ${counted(launch.posts)} posts published, ${n(launch.postsScheduled)} scheduled`
      + `${engaged ? `; ${n(engaged)} likes, reposts and replies${launch.engagement.impressions ? ` and ${n(launch.engagement.impressions)} impressions` : ""} on campaign posts` : ""}.`,
    `Grow: ${counted(grow.leads)} new leads, ${counted(grow.won)} won, conversion ${grow.conversion === null ? "n/a" : `${Math.round(grow.conversion * 100)}%`} of ${n(grow.total)} leads, open pipeline ${money(grow.pipelineValue)}`
      + `${funnel ? `; by stage: ${funnel}` : ""}; ${n(grow.repliesAwaiting)} unread replies from ${n(grow.leadsAwaiting)} leads, ${n(grow.draftsAwaiting)} agent drafts awaiting approval.`,
    `Team: ${counted(team.runs)} agent runs (${n(team.succeeded)} succeeded, ${n(team.failed)} failed, ${n(team.live)} live) by ${n(team.agents)} agents, ${formatUsd(team.spendRangeUsd)} spent in range;`
      + ` ${formatUsd(team.spendMonthUsd)} this month${team.budgetUsd === null ? ", no budget set" : ` of a ${formatUsd(team.budgetUsd)} budget${team.budgetLevel === "over" ? " (reached)" : team.budgetLevel === "warn" ? " (over 80%)" : ""}`}; ${n(team.approvalsWaiting)} approvals waiting.`,
    pulse.attention.length ? `Needs attention: ${pulse.attention.map((item) => attentionLabel(item, team.budgetLevel)).join(", ")}.` : "Nothing waiting on a person.",
    ...(pulse.truncated ? ["Some reads stopped at their bound, so a few counts may be low."] : []),
  ].join("\n");
}

const rangeOf = (value: unknown): PulseRange => (value === 30 || value === "30" ? 30 : 7);

type PulseTool<C> = (args: Args, ctx: C) => Promise<{ text: string }>;

/** origin_pulse; `scopes` picks the named project, or every project the agent reaches. */
export function pulseTools<C>(scopes: (args: Args, ctx: C) => Promise<PulseToolScope[]>): Record<string, PulseTool<C>> {
  return {
    async origin_pulse(args, ctx) {
      const range = rangeOf(args.range);
      const targets = (await scopes(args, ctx)).slice(0, PROJECTS_MAX);
      const blocks = await Promise.all(targets.map(async (scope) => {
        try {
          return pulseText(await scope.client.query("pulse:project", { sessionToken: scope.sessionToken, projectId: scope.projectId, range }) as ProjectPulse);
        } catch (error) {
          return `${scope.projectName}: Origin did not return its pulse (${errorText(error).split("\n")[0]}).`;
        }
      }));
      return { text: blocks.join("\n\n") || "No Origin project to report on." };
    },
  };
}
