export interface ModelChoice {
  instanceId: string;
  model: string;
  effort?: string;
}

export type PlanVia = "intent" | "default" | "fallback" | "none";

/** GET /api/origin/shared-agents/plan: what each shared bot runs on for the person at this desktop. */
export interface SharedAgentPlan {
  defaults: Record<string, ModelChoice>;
  bots: Array<{
    botId: string;
    name: string;
    intent: { provider: string; model: string; effort?: string } | null;
    resolved: { instanceId: string; model: string; label: string } | null;
    via: PlanVia;
  }>;
}

interface PlanInstance {
  instanceId: string;
  driverKind: string;
  displayName: string;
  models: { default: string; options: ReadonlyArray<{ id: string; label: string }> };
}

export interface ProviderDefault<Instance> {
  driverKind: string;
  instance: Instance;
  options: Array<ModelChoice & { label: string }>;
  selected: number;
}

const VIA: ReadonlySet<string> = new Set(["intent", "default", "fallback", "none"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parsePlan(body: unknown): SharedAgentPlan | null {
  const plan = record(body);
  const defaults = record(plan?.defaults);
  if (!plan || !defaults || !Array.isArray(plan.bots)) return null;
  const bots = plan.bots.filter((bot): bot is SharedAgentPlan["bots"][number] => {
    const row = record(bot);
    return Boolean(row && typeof row.botId === "string" && typeof row.name === "string" && VIA.has(String(row.via)));
  });
  return { defaults: defaults as SharedAgentPlan["defaults"], bots };
}

function sameChoice(a: ModelChoice | undefined, b: ModelChoice): boolean {
  return a?.instanceId === b.instanceId && a.model === b.model;
}

export function providerDefaults<Instance extends PlanInstance>(
  ready: readonly Instance[],
  saved: Record<string, ModelChoice>,
): Array<ProviderDefault<Instance>> {
  const kinds = [...new Set(ready.map((instance) => instance.driverKind))];
  return kinds.map((driverKind) => {
    const instances = ready.filter((instance) => instance.driverKind === driverKind);
    const named = instances.length > 1;
    const options = instances.flatMap((instance) => {
      const models = instance.models.options.length
        ? instance.models.options
        : instance.models.default ? [{ id: instance.models.default, label: instance.models.default }] : [];
      return models.map((model) => ({
        instanceId: instance.instanceId,
        model: model.id,
        label: named ? `${instance.displayName} · ${model.label}` : model.label,
      }));
    });
    const first = instances[0]!;
    const savedAt = options.findIndex((option) => sameChoice(saved[driverKind], option));
    const fallbackAt = options.findIndex((option) => option.instanceId === first.instanceId && option.model === first.models.default);
    return { driverKind, instance: first, options, selected: savedAt >= 0 ? savedAt : Math.max(fallbackAt, 0) };
  }).filter((row) => row.options.length > 0);
}

export function defaultsPayload<Instance>(
  rows: ReadonlyArray<ProviderDefault<Instance>>,
  saved: Record<string, ModelChoice>,
): Record<string, ModelChoice> {
  const chosen = Object.fromEntries(rows.map((row) => {
    const { instanceId, model } = row.options[row.selected]!;
    const effort = sameChoice(saved[row.driverKind], { instanceId, model }) ? saved[row.driverKind]!.effort : undefined;
    return [row.driverKind, effort ? { instanceId, model, effort } : { instanceId, model }];
  }));
  return { ...saved, ...chosen };
}

export function defaultsChanged(next: Record<string, ModelChoice>, saved: Record<string, ModelChoice>): boolean {
  const kinds = new Set([...Object.keys(next), ...Object.keys(saved)]);
  return [...kinds].some((kind) => {
    const a = next[kind];
    const b = saved[kind];
    return !a || !b || !sameChoice(a, b) || a.effort !== b.effort;
  });
}
