import { REMOTE_MODEL_INSTANCE } from "../shared/model-selection.ts";
import { sameModelSelection } from "../shared/thread-model.ts";
import type { ModelSelection } from "./contracts.ts";
import { defaultModelSelectionSchema } from "./model-selection-config.ts";

export type ModelSelectionCheck = { ok: true; selection: ModelSelection } | { ok: false; status: number; error: string };
export type ModelSelectionCurrent = { selection: ModelSelection; busy: boolean };
export type ModelSelectionScope = { botId: string; threadId?: string };
export type ModelSelectionChecker = (
  raw: unknown, current?: ModelSelectionCurrent, requireAvailableModel?: boolean, scope?: ModelSelectionScope,
) => ModelSelectionCheck | Promise<ModelSelectionCheck>;

export function createScopedModelSelectionChecker(deps: {
  local(raw: ModelSelection, current?: ModelSelectionCurrent, requireAvailableModel?: boolean): ModelSelectionCheck;
  remote(scope: ModelSelectionScope, selection: ModelSelection): Promise<void>;
}): ModelSelectionChecker {
  return async (raw, current, requireAvailableModel, scope) => {
    const parsed = defaultModelSelectionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid model selection" };
    const selection: ModelSelection = parsed.data;
    if (current?.busy && !sameModelSelection(selection, current.selection)) {
      return { ok: false, status: 409, error: "the bot is working — stop it before changing models" };
    }
    if (selection.instanceId !== REMOTE_MODEL_INSTANCE) return deps.local(selection, current, requireAvailableModel);
    if (!scope?.botId) return { ok: false, status: 400, error: "Choose a shared account for a bound workspace or project agent" };
    if (selection.effort !== undefined || selection.variant !== undefined) {
      return { ok: false, status: 400, error: "Shared accounts currently use the source model's default effort and variant" };
    }
    try {
      await deps.remote(scope, selection);
      return { ok: true, selection };
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error && Number.isInteger(error.status) &&
        Number(error.status) >= 400 && Number(error.status) < 500 ? Number(error.status) : 503;
      return { ok: false, status, error: status === 503 ? "The shared account could not be verified. Try again when its computer is online."
        : error instanceof Error ? error.message : "The shared account is unavailable" };
    }
  };
}
