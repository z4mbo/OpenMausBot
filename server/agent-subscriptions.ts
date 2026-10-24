import type { AgentSubscription } from "../shared/agent-subscription.ts";
import { claudeInstanceOwnsRouting } from "./config.ts";
import type { InstanceConfig, InstanceConfigMap } from "./contracts.ts";
import { planAccountsFromInstances, type PlanAccount, type PlanUsageReport } from "./plan-usage.ts";

const PLAN_TTL_MS = 30 * 60_000;
const PLAN_RETRY_MS = 5 * 60_000;

const SUBSCRIPTION_DRIVERS: Record<string, AgentSubscription["provider"]> = { claudeAgent: "claude", codex: "chatgpt", grokAgent: "grok" };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function instanceSubscription(entry: InstanceConfig, plan: string | null): AgentSubscription {
  const config = record(entry.config);
  const provider = SUBSCRIPTION_DRIVERS[entry.driver];
  const onKey = !provider || entry.access === "api" || config?.requireApiKey === true || Boolean(config?.managed)
    || (provider === "claude" && claudeInstanceOwnsRouting(entry.environment));
  if (onKey) {
    const name = entry.displayName?.trim();
    return { provider: "key", ...(name ? { plan: name } : {}) };
  }
  return { provider, ...(plan ? { plan } : {}) };
}

/** This computer's accounts by instance id. Plan names come from the providers' usage endpoints, so they are fetched at
 * most every half hour. */
export function createSubscriptions(deps: { instances(): InstanceConfigMap; usage(accounts: PlanAccount[]): Promise<PlanUsageReport>; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let plans: { key: string; until: number; byId: Map<string, string | null> } | null = null;
  let loading: Promise<Map<string, string | null>> | null = null;

  const planNames = async (accounts: PlanAccount[]) => {
    const key = accounts.map((account) => account.id).sort().join("\n");
    if (plans && plans.key === key && now() < plans.until) return plans.byId;
    loading ??= deps.usage(accounts).then(
      (report) => {
        const byId = new Map(report.providers.map((row) => [row.id, row.plan]));
        plans = { key, until: now() + PLAN_TTL_MS, byId };
        return byId;
      },
      () => {
        const byId = plans?.byId ?? new Map<string, string | null>();
        plans = { key, until: now() + PLAN_RETRY_MS, byId };
        return byId;
      },
    ).finally(() => { loading = null; });
    return loading;
  };

  return {
    async all(): Promise<Record<string, AgentSubscription>> {
      const instances = deps.instances();
      const byId = await planNames(planAccountsFromInstances(instances));
      return Object.fromEntries(Object.entries(instances)
        .filter(([, entry]) => entry.enabled !== false)
        .map(([id, entry]) => [id, instanceSubscription(entry, byId.get(id) ?? null)]));
    },
  };
}
