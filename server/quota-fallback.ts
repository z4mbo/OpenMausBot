import type { ModelSelection, ProviderInstance, ProviderSnapshot } from "./contracts.ts";
import { modelSwitchNeedsAsk, type ApprovalMode } from "../shared/approval-mode.ts";
import { recoveryCapabilityError } from "./automatic-recovery.ts";
import { modelPairKey } from "../shared/model-selection.ts";

export { modelPairKey };

export function quotaFallbackPolicyRefusal(input: {
  approvalMode: ApprovalMode;
  selection: ModelSelection;
  source: ProviderInstance;
  target: ProviderInstance;
  hosted?: { allows(selection: ModelSelection): boolean; error(): string };
  providerRefusal(instance: ProviderInstance): string | undefined;
}): string | undefined {
  if (modelSwitchNeedsAsk(input.approvalMode, input.source.driverKind, input.target.driverKind)) return "The backup requires a different approval mode";
  if (input.hosted && !input.hosted.allows(input.selection)) return input.hosted.error();
  return input.providerRefusal(input.target) ?? recoveryCapabilityError(
    { driverKind: input.source.driverKind, capabilities: input.source.adapter.capabilities },
    { driverKind: input.target.driverKind, capabilities: input.target.adapter.capabilities });
}

export async function chooseQuotaFallback(input: {
  chain: ReadonlyArray<ModelSelection>;
  visited: ReadonlySet<string>;
  blockedInstances: ReadonlySet<string>;
  engine(instanceId: string): ProviderInstance | null | undefined;
  current(): boolean;
  validate(selection: ModelSelection, engine: ProviderInstance, snapshot: ProviderSnapshot): string | undefined;
  timeoutMs?: number;
}): Promise<{ selection: ModelSelection; engine: ProviderInstance } | null> {
  const unique = new Set<string>();
  const candidates = input.chain.slice(0, 5).filter(selection => {
    const key = modelPairKey(selection);
    if (unique.has(key) || input.visited.has(key) || input.blockedInstances.has(selection.instanceId)) return false;
    unique.add(key);
    return true;
  });
  const snapshots = await Promise.all(candidates.map(async selection => {
    const engine = input.engine(selection.instanceId);
    if (!engine?.enabled) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const snapshot = await Promise.race([
        Promise.resolve().then(() => engine.snapshot()),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), input.timeoutMs ?? 8_000); timer.unref?.(); }),
      ]);
      return snapshot ? { selection, engine, snapshot } : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }));
  for (const candidate of snapshots) {
    if (!input.current()) return null;
    if (!candidate || input.engine(candidate.selection.instanceId) !== candidate.engine || candidate.snapshot.state !== "available" || candidate.snapshot.authenticated === false) continue;
    if (!candidate.engine.models.options.some(model => model.id === candidate.selection.model) && candidate.engine.models.default !== candidate.selection.model) continue;
    if (!input.validate(candidate.selection, candidate.engine, candidate.snapshot)) return { selection: candidate.selection, engine: candidate.engine };
  }
  return null;
}
