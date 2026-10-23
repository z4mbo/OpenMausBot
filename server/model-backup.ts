import { modelPairKey, REMOTE_MODEL_INSTANCE } from "../shared/model-selection.ts";
import type { ModelSelection } from "./contracts.ts";

export function modelAccountKey(selection: ModelSelection): string {
  return selection.source
    ? JSON.stringify([REMOTE_MODEL_INSTANCE, selection.source.hostId, selection.source.sourceId])
    : JSON.stringify([selection.instanceId]);
}

/** Availability and policy preparation is read-only; accepting or dispatching a backup remains the caller's fenced operation. */
export async function chooseModelBackup<T>(input: {
  chain: ReadonlyArray<ModelSelection>;
  visited: ReadonlySet<string>;
  blockedAccounts: ReadonlySet<string>;
  current(): boolean;
  prepare(selection: ModelSelection): Promise<T | null>;
  timeoutMs?: number;
}): Promise<{ selection: ModelSelection; value: T } | null> {
  const seen = new Set<string>();
  for (const candidate of input.chain.slice(0, 5)) {
    if (!input.current()) return null;
    const selection = structuredClone(candidate), key = modelPairKey(selection);
    if (seen.has(key) || input.visited.has(key) || input.blockedAccounts.has(modelAccountKey(selection))) continue;
    seen.add(key);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => input.prepare(selection)),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), input.timeoutMs ?? 8_000); timer.unref?.(); }),
      ]);
      if (!input.current()) return null;
      if (value !== null) return { selection, value };
    } catch {
      if (!input.current()) return null;
    } finally { clearTimeout(timer); }
  }
  return null;
}
