import type { EffortLevel, EngineAccess, ModelCatalog, ModelSelection, ProviderSnapshot } from "./contracts.ts";

export interface SelectableInstance {
  instanceId: string;
  driverKind: string;
  snapshot: ProviderSnapshot;
  models: ModelCatalog;
  capabilities?: { effortLevels?: readonly EffortLevel[]; modelVariants?: boolean };
  access?: EngineAccess;
  enabled?: boolean;
}

export interface DefaultSelectionContext {
  company?: (instanceId: string) => boolean;
  refusal?: (instance: SelectableInstance) => string | undefined;
}

const claudeFirst = (instances: readonly SelectableInstance[]) =>
  instances.find((instance) => instance.driverKind === "claudeAgent") ?? instances[0];

/** A custom endpoint brings its own credential, so its sign-in state does not count. */
export function signedOut(instance: SelectableInstance): boolean {
  return instance.snapshot.state === "available" && instance.access !== "custom" && instance.snapshot.authenticated === false;
}

export function readyToRun(instance: SelectableInstance, context: DefaultSelectionContext = {}): boolean {
  return instance.enabled !== false && instance.snapshot.state === "available" && context.refusal?.(instance) === undefined && !signedOut(instance);
}

const defaultModel = (instance: SelectableInstance) => instance.models.default.trim()
  ? instance.models.default
  : instance.models.options.find((model) => model.id.trim())?.id ?? "";

/** A saved choice is intentional: an unavailable provider sends new bots to setup, never silently to another provider. On
 * an enrolled desktop a working personal engine beats a Company one, so billing stays the person's choice. */
export function selectDefaultModelSelection(
  instances: readonly SelectableInstance[],
  preferred?: ModelSelection,
  context: DefaultSelectionContext = {},
): ModelSelection {
  if (preferred && (preferred.instanceId || preferred.model)) {
    const instance = instances.find((candidate) => candidate.instanceId === preferred.instanceId);
    if (
      instance?.snapshot.state !== "available" ||
      instance.enabled === false ||
      signedOut(instance) ||
      !preferred.model.trim() ||
      // A disallowed saved engine is unusable like an unavailable one: setup, never another provider.
      context.refusal?.(instance) !== undefined ||
      (preferred.variant !== undefined && !instance.capabilities?.modelVariants) ||
      !(instance.models.default === preferred.model || instance.models.options.some((model) => model.id === preferred.model))
    ) {
      return { instanceId: "", model: "" };
    }
    const selection = { ...preferred };
    // A saved effort can outlive driver support: keep the model, let the provider use its default effort.
    if (selection.effort && !instance.capabilities?.effortLevels?.includes(selection.effort)) delete selection.effort;
    return selection;
  }
  const available = instances.filter((instance) => instance.enabled !== false && instance.snapshot.state === "available" && context.refusal?.(instance) === undefined && defaultModel(instance));
  const ready = available.filter((instance) => readyToRun(instance, context));
  const company = context.company;
  const personal = company && instances.some((instance) => company(instance.instanceId))
    ? claudeFirst(ready.filter((instance) => !company(instance.instanceId)))
    : undefined;
  const pick = personal ?? claudeFirst(ready) ?? claudeFirst(available);
  return { instanceId: pick?.instanceId ?? "", model: pick ? defaultModel(pick) : "" };
}

/** An explicit effort or variant wins; an engine without the level sends none rather than failing turn 1. */
export function withNewBotEffort(
  selection: ModelSelection,
  effort: EffortLevel | undefined,
  offered: readonly EffortLevel[] | undefined,
): ModelSelection {
  if (!effort || selection.effort !== undefined || selection.variant !== undefined || !offered?.includes(effort)) {
    return selection;
  }
  return { ...selection, effort };
}

export interface ModelIntent { provider: string; model: string; effort?: string }
export type SharedModelVia = "intent" | "default" | "fallback" | "none";

/** What a shared bot runs on for this member: its own model when this machine can run it, else the member's default for that
 * provider, else any ready engine. Never another member's account: every candidate is one of this machine's instances. */
export function resolveSharedModel(
  instances: readonly SelectableInstance[],
  intent: ModelIntent | null | undefined,
  defaults: Readonly<Record<string, ModelSelection>> = {},
  context: DefaultSelectionContext = {},
): { selection: ModelSelection; via: SharedModelVia } {
  if (intent?.provider && intent.model) {
    const exact = instances.find((instance) => instance.driverKind === intent.provider && readyToRun(instance, context)
      && (instance.models.default === intent.model || instance.models.options.some((model) => model.id === intent.model)));
    if (exact) {
      const effort = intent.effort as EffortLevel | undefined;
      const selection: ModelSelection = { instanceId: exact.instanceId, model: intent.model };
      return { selection: effort && exact.capabilities?.effortLevels?.includes(effort) ? { ...selection, effort } : selection, via: "intent" };
    }
    const preferred = defaults[intent.provider];
    const chosen = preferred ? selectDefaultModelSelection(instances, preferred, context) : null;
    if (chosen?.instanceId) return { selection: chosen, via: "default" };
  }
  const fallback = selectDefaultModelSelection(instances, undefined, context);
  const ready = instances.find((instance) => instance.instanceId === fallback.instanceId);
  return ready && readyToRun(ready, context) ? { selection: fallback, via: "fallback" } : { selection: { instanceId: "", model: "" }, via: "none" };
}
