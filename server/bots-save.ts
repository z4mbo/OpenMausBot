import { approvalModeFor, type ApprovalMode } from "../shared/approval-mode.ts";
import type { BotRecord, TaskPatch, TaskRecord } from "./store.ts";

export class BotsSaveError extends Error {
  constructor(action: string, cause: unknown) {
    super(`Couldn't save ${action}: Origin couldn't write bots.json. Check that its data folder is writable and try again.`, { cause });
    this.name = "BotsSaveError";
  }
}

export function commitBotChange(bot: BotRecord, action: string, save: () => void, change: () => void, onRollback?: () => void) {
  const { tasks, ...fields } = bot;
  const saved = structuredClone(fields), list = tasks ? [...tasks] : undefined;
  const states = list?.map(task => structuredClone(task));
  try { change(); save(); }
  catch (error) {
    restore(bot, tasks ? { ...saved, tasks } : saved);
    if (tasks && list) tasks.splice(0, tasks.length, ...list);
    list?.forEach((task, index) => restore(task, states![index]!));
    onRollback?.();
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (typeof code === "string" && /^E[A-Z]+$/.test(code)) throw new BotsSaveError(action, error);
    throw error;
  }
}

function restore<T extends object>(target: T, saved: T) {
  for (const key of Object.keys(target) as (keyof T)[]) if (!Object.hasOwn(saved, key)) delete target[key];
  Object.assign(target, saved);
}

function modeFor(task: TaskRecord, bot: BotRecord): ApprovalMode {
  return approvalModeFor({
    approvalMode: task.approvalMode ?? (task.autoApprove === undefined ? bot.approvalMode : undefined),
    autoApprove: task.autoApprove ?? bot.autoApprove,
  });
}

function noBroaderMode(before: ApprovalMode, after: ApprovalMode) {
  if (before === after || after === "ask" || before === "full") return true;
  return before === "auto" && after === "edits";
}

// Failed saves cannot enable grants; privacy and permission revocations stay effective immediately.
export function taskRevocations(bot: BotRecord, task: TaskRecord, patch: TaskPatch): TaskPatch {
  const kept: TaskPatch = {}, next = { ...task, ...patch };
  if (noBroaderMode(modeFor(task, bot), modeFor(next, bot))) {
    if (Object.hasOwn(patch, "approvalMode")) kept.approvalMode = next.approvalMode;
    if (Object.hasOwn(patch, "autoApprove")) kept.autoApprove = next.autoApprove;
  }
  if (Object.hasOwn(patch, "alwaysAllow")) {
    const before = new Set(task.alwaysAllow ?? bot.alwaysAllow ?? []);
    kept.alwaysAllow = (next.alwaysAllow ?? bot.alwaysAllow ?? []).filter(key => before.has(key));
  }
  if (patch.sharedPrivate === true) kept.sharedPrivate = true;
  if (Object.hasOwn(patch, "shared") && patch.shared === undefined) kept.shared = undefined;
  return structuredClone(kept);
}
