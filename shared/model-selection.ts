import type { ModelSelection } from "./wire.ts";

export const REMOTE_MODEL_INSTANCE = "origin-remote";

export function modelPairKey(selection: Pick<ModelSelection, "instanceId" | "model" | "source">): string {
  return JSON.stringify([selection.instanceId, selection.model, ...(selection.source ? [selection.source.hostId, selection.source.sourceId] : [])]);
}

export function sameModelSource(a: ModelSelection["source"], b: ModelSelection["source"]): boolean {
  return a?.hostId === b?.hostId && a?.sourceId === b?.sourceId;
}
