import { BroadcastScheduler, createBroadcastRoutes } from "../broadcast/scheduler.ts";
import { convexOriginClient, createOriginCloudRoutes, defaultOriginCloudFile, readOriginCloud, type OriginCloudRouteDeps } from "../origin-cloud.ts";
import { setStudioBudgetGuard } from "../origin-studio.ts";
import { DailyApiBudgetError } from "../daily-api-budget.ts";
import type { BotRecord } from "../store.ts";

export function projectChiefForBudget(bots: readonly Pick<BotRecord, "id" | "hidden" | "chiefOfStaff">[], projects: Record<string, string>, projectId: string): string | undefined {
  const chiefs = bots.filter(bot => !bot.hidden && bot.chiefOfStaff && projects[bot.id] === projectId);
  if (chiefs.length > 1) throw new DailyApiBudgetError("More than one project Chief is linked here. Resolve the project links before starting paid AI work.");
  return chiefs[0]?.id;
}

export function createProjectToolsHost(deps: OriginCloudRouteDeps, runtime: {
  studioBudget: NonNullable<Parameters<typeof setStudioBudgetGuard>[0]>;
}) {
  setStudioBudgetGuard(input => runtime.studioBudget({ ...input, botId: input.botId ?? (input.projectId ? projectChiefForBudget(deps.store.bots, readOriginCloud(defaultOriginCloudFile()).projects, input.projectId) : undefined) }));
  const broadcast = new BroadcastScheduler({
    session: () => readOriginCloud(defaultOriginCloudFile()),
    connect: convexOriginClient,
    log: message => console.warn(message),
  });
  return {
    routes: [createOriginCloudRoutes(deps), createBroadcastRoutes({ scheduler: broadcast })],
    start: () => broadcast.start(),
  };
}
