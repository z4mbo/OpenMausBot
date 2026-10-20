import { BroadcastScheduler, createBroadcastRoutes } from "../broadcast/scheduler.ts";
import { convexOriginClient, createOriginCloudRoutes, defaultOriginCloudFile, readOriginCloud, type OriginCloudRouteDeps } from "../origin-cloud.ts";
import { createPipelineRoutes, createPipelineSender, loopbackProviderOrigin, type PipelineSenderDeps } from "../origin-pipeline.ts";
import { setStudioBudgetGuard } from "../origin-studio.ts";
import { DailyApiBudgetError } from "../daily-api-budget.ts";
import type { BotRecord } from "../store.ts";

export function projectChiefForBudget(bots: readonly Pick<BotRecord, "id" | "hidden" | "chiefOfStaff">[], projects: Record<string, string>, projectId: string): string | undefined {
  const chiefs = bots.filter(bot => !bot.hidden && bot.chiefOfStaff && projects[bot.id] === projectId);
  if (chiefs.length > 1) throw new DailyApiBudgetError("More than one project Chief is linked here. Resolve the project links before starting paid AI work.");
  return chiefs[0]?.id;
}

export function createProjectToolsHost(deps: Omit<OriginCloudRouteDeps, "pipeline">, runtime: {
  summarize: NonNullable<PipelineSenderDeps["summarize"]>;
  studioBudget: NonNullable<Parameters<typeof setStudioBudgetGuard>[0]>;
  pipelineAiBudget: NonNullable<PipelineSenderDeps["checkAiBudget"]>;
}) {
  setStudioBudgetGuard(runtime.studioBudget);
  const providerOrigin = loopbackProviderOrigin(process.env.OMB_PIPELINE_PROVIDER_URL);
  const pipeline = createPipelineSender({ ...(providerOrigin ? { providerOrigin } : {}), summarize: runtime.summarize, checkAiBudget: runtime.pipelineAiBudget, log: line => console.log(line) });
  const broadcast = new BroadcastScheduler({
    session: () => readOriginCloud(defaultOriginCloudFile()),
    connect: convexOriginClient,
    log: message => console.warn(message),
  });
  return {
    routes: [createPipelineRoutes({ sender: pipeline, botForProject: projectId => {
      const projects = readOriginCloud(defaultOriginCloudFile()).projects;
      return projectChiefForBudget(deps.store.bots, projects, projectId);
    } }), createOriginCloudRoutes({ ...deps, pipeline }), createBroadcastRoutes({ scheduler: broadcast })],
    start: () => broadcast.start(),
  };
}
