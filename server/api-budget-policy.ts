import type { InstanceConfig, ProviderInstance, ProviderSnapshot } from "./contracts.ts";
import { claudeInstanceOwnsRouting, type AppConfig } from "./config.ts";
import { createApiRequestBudget, dailyApiBudgetEnabled, dailyApiBudgetForDataDir, DailyApiBudgetError, quoteApiBudgetRequest, type ApiRequestBudget } from "./daily-api-budget.ts";

export type ModelBilling = "subscription" | "metered" | "unknown";

export function modelBilling(driverKind: string, config: InstanceConfig | undefined, snapshot: ProviderSnapshot | undefined, model?: string, customModel = false): ModelBilling {
  const raw = config?.config && typeof config.config === "object" ? config.config as Record<string, unknown> : undefined;
  if (config?.access === "api" || snapshot?.billing === "metered" || snapshot?.account?.method === "api-key" || raw?.requireApiKey === true || raw?.managed ||
      (driverKind === "claudeAgent" && claudeInstanceOwnsRouting(config?.environment))) return "metered";
  if (model?.includes("::") || config?.access === "custom" || customModel) return "unknown";
  if (["grok", "openai-compat", "mistral", "cerebras", "groq", "meta"].includes(driverKind)) return "metered";
  return snapshot?.billing === "subscription" ? "subscription" : "unknown";
}

export function createApiBudgetHost(deps: {
  dataDir: string;
  config(): Pick<AppConfig, "dailyApiBudget">;
  bot(botId: string): { dailyApiBudgetUsd?: number } | null | undefined;
  provider(instanceId: string): InstanceConfig | undefined;
  snapshot(instanceId: string): ProviderSnapshot | undefined;
  current?(instance: ProviderInstance): boolean;
  probeTimeoutMs?: number;
}) {
  const confirmed = new WeakMap<ProviderInstance, { snapshot: ProviderSnapshot; baseline: ProviderSnapshot | undefined }>();
  const snapshotFor = (instance: ProviderInstance) => {
    const current = deps.snapshot(instance.instanceId), captured = confirmed.get(instance);
    if (captured && captured.baseline === current) return captured.snapshot;
    confirmed.delete(instance);
    return current;
  };
  const forModel = (instance: ProviderInstance | null | undefined, botId: string, model?: string): ApiRequestBudget | undefined => {
    const policy = () => ({ limitUsd: deps.config().dailyApiBudget?.limitUsd, agentLimitUsd: deps.bot(botId)?.dailyApiBudgetUsd,
      timeZone: deps.config().dailyApiBudget?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC" });
    const enabled = dailyApiBudgetEnabled(policy());
    if (!instance) {
      if (enabled) throw new DailyApiBudgetError("This API model is no longer available.");
      return undefined;
    }
    const selected = model ?? instance.models.default;
    const billing = modelBilling(instance.driverKind, deps.provider(instance.instanceId), snapshotFor(instance), selected,
      instance.models.options.find(option => option.id === selected)?.custom === true);
    if (billing === "subscription") return undefined;
    if (instance.adapter.capabilities.apiRequestBudget !== true) {
      if (enabled) throw new DailyApiBudgetError("This model cannot enforce the daily API budget. Choose a supported API model or a confirmed subscription connection.");
      return undefined;
    }
    const budget = dailyApiBudgetForDataDir(deps.dataDir);
    const state = budget.status(policy(), [{ botId, limitUsd: policy().agentLimitUsd }]);
    if (state.global?.exceeded || state.agents.some(agent => agent.botId === botId && agent.exceeded)) throw new DailyApiBudgetError("The daily API budget has been reached. Subscription models remain available.");
    return createApiRequestBudget({ budget, botId, policy });
  };
  return Object.assign(forModel, {
    async prepare(instance: ProviderInstance | null | undefined, botId: string, model?: string): Promise<ApiRequestBudget | undefined> {
      if (instance && (!instance.enabled || deps.current?.(instance) === false)) throw new DailyApiBudgetError("This model connection changed before dispatch. Try again.");
      const policy = { limitUsd: deps.config().dailyApiBudget?.limitUsd, agentLimitUsd: deps.bot(botId)?.dailyApiBudgetUsd,
        timeZone: deps.config().dailyApiBudget?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC" };
      if (instance && dailyApiBudgetEnabled(policy) && instance.adapter.capabilities.apiRequestBudget !== true &&
          modelBilling(instance.driverKind, deps.provider(instance.instanceId), snapshotFor(instance), model ?? instance.models.default) !== "metered") {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const snapshot = await Promise.race([Promise.resolve().then(() => instance.snapshot()),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("billing probe timed out")), deps.probeTimeoutMs ?? 8_000); timer.unref?.(); })]);
          if (snapshot.state !== "available" || snapshot.authenticated === false || !deps.bot(botId) || !instance.enabled || deps.current?.(instance) === false) throw new Error("billing unavailable");
          confirmed.set(instance, { snapshot, baseline: deps.snapshot(instance.instanceId) });
        } catch {
          throw new DailyApiBudgetError("Could not confirm this model's billing before applying the daily API budget. Refresh the connection and try again.");
        } finally { clearTimeout(timer); }
      }
      return forModel(instance, botId, model);
    },
    fallbackRefusal(instance: ProviderInstance, botId: string, model: string, snapshot: ProviderSnapshot, apiAllowed: boolean): string | undefined {
      const billing = modelBilling(instance.driverKind, deps.provider(instance.instanceId), snapshot, model,
        instance.models.options.find(option => option.id === model)?.custom === true);
      if (billing !== "subscription" && !apiAllowed) return "API fallback is not allowed";
      confirmed.set(instance, { snapshot, baseline: deps.snapshot(instance.instanceId) });
      try {
        const hook = forModel(instance, botId, model);
        if (hook && hook.enabled?.() !== false) {
          const policy = { limitUsd: deps.config().dailyApiBudget?.limitUsd, agentLimitUsd: deps.bot(botId)?.dailyApiBudgetUsd,
            timeZone: deps.config().dailyApiBudget?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC" };
          const quote = quoteApiBudgetRequest({ model, contextWindow: instance.models.options.find(option => option.id === model)?.contextWindow, maxOutputTokens: 4096 });
          const status = dailyApiBudgetForDataDir(deps.dataDir).status(policy, [{ botId, limitUsd: policy.agentLimitUsd }]);
          if ((status.global && quote.maximumUsd > status.global.remainingUsd) || status.agents.some(agent => agent.botId === botId && agent.remainingUsd !== undefined && quote.maximumUsd > agent.remainingUsd)) return "This backup cannot fit within the remaining daily API budget";
        }
      } catch (failure) { return failure instanceof Error ? failure.message : "The API budget could not be checked"; }
      return undefined;
    },
  });
}
