import type { InstanceInfo, ModelSelection } from "@/state/store";
import { isCustomOnly, signInFamily, SIGN_IN_FAMILY_LABEL, splitEngineRail, type SignInFamily } from "@/lib/engine-rail";
import { filterCustomModels, partitionCustomModels, suggestedModels } from "@/lib/custom-models";
import { needsCli, needsSignIn } from "./EngineSetup";

export type ModelOption = InstanceInfo["models"]["options"][number];
export type PickerGroupStatus = "ready" | "signIn" | "setup" | "policy";
export type PickerAccess = "subscription" | "api" | "custom";

export interface PickerGroup {
  key: string;
  label: string;
  family?: SignInFamily;
  instance: InstanceInfo;
  accounts: InstanceInfo[];
  access: PickerAccess;
  status: PickerGroupStatus;
  models: ModelOption[];
  local: ModelOption[];
  current: boolean;
}

export const SUGGESTED_COUNT = 5;
export const LOCAL_PROBE_TIMEOUT_MS = 5_000;

export function probeLocalModels(
  instanceId: string,
  refreshModels: (instanceId: string) => Promise<void>,
  timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void refreshModels(instanceId)
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

export function offersLocalModels(instance: InstanceInfo | undefined, localCount: number): boolean {
  if (!instance) return false;
  return localCount > 0 || (instance.driverKind === "claudeAgent" && !needsCli(instance) && !instance.policy);
}

export function pickerGroupKey(instance: InstanceInfo): string {
  const family = signInFamily(instance);
  return family ? `family:${family}` : instance.instanceId;
}

function ready(instance: InstanceInfo): boolean {
  return !needsCli(instance) && !needsSignIn(instance);
}

function shownAccount(accounts: InstanceInfo[], chosen: string | undefined, selectedId: string): InstanceInfo {
  return accounts.find((account) => account.instanceId === chosen)
    ?? accounts.find((account) => account.instanceId === selectedId)
    ?? accounts.find(ready)
    ?? accounts[0]!;
}

function statusOf(instance: InstanceInfo): PickerGroupStatus {
  if (instance.policy) return "policy";
  if (needsCli(instance)) return "setup";
  if (needsSignIn(instance) && !isCustomOnly(instance)) return "signIn";
  return "ready";
}

function loadedFirst(options: readonly ModelOption[]): ModelOption[] {
  const { pinned, rest } = partitionCustomModels(options);
  return [...pinned, ...rest];
}

export function pickerGroups(
  instances: readonly InstanceInfo[],
  selection: Pick<ModelSelection, "instanceId">,
  chosen: Partial<Record<SignInFamily, string>> = {},
): PickerGroup[] {
  const families = new Map<SignInFamily, InstanceInfo[]>();
  const entries: Array<InstanceInfo | SignInFamily> = [];
  for (const instance of instances) {
    const family = signInFamily(instance);
    if (!family) {
      entries.push(instance);
      continue;
    }
    if (!families.has(family)) {
      families.set(family, []);
      entries.push(family);
    }
    families.get(family)!.push(instance);
  }
  const groups = entries.map((entry): PickerGroup => {
    const family = typeof entry === "string" ? entry : undefined;
    const accounts = family ? families.get(family)! : [entry as InstanceInfo];
    const instance = family ? shownAccount(accounts, chosen[family], selection.instanceId) : accounts[0]!;
    const custom = instance.models.options.filter((option) => option.custom);
    const customOnly = isCustomOnly(instance);
    return {
      key: family ? `family:${family}` : instance.instanceId,
      label: family ? SIGN_IN_FAMILY_LABEL[family] : instance.displayName,
      family,
      instance,
      accounts,
      access: accounts[0]!.access === "api" ? "api" : accounts[0]!.access === "custom" ? "custom" : "subscription",
      status: statusOf(instance),
      models: customOnly ? loadedFirst(custom) : instance.models.options.filter((option) => !option.custom),
      local: customOnly ? [] : loadedFirst(custom),
      current: accounts.some((account) => account.instanceId === selection.instanceId),
    };
  });
  const { subscription, api, custom } = splitEngineRail(groups);
  return [...subscription, ...api, ...custom];
}

export function groupModels(group: PickerGroup, query: string, expanded: boolean, currentModel: string | undefined): { shown: ModelOption[]; more: number } {
  const pickable = group.status === "ready" ? group.models : [];
  const local = group.status === "ready" || group.status === "signIn" ? group.local : [];
  if (query.trim()) return { shown: filterCustomModels([...pickable, ...local], query), more: 0 };
  const running = local.find((option) => option.id === currentModel);
  const shown = expanded ? pickable : suggestedModels(pickable, group.instance.models.default, currentModel, SUGGESTED_COUNT);
  return { shown: running ? [running, ...shown] : shown, more: pickable.length - shown.length };
}

export function groupMatches(group: PickerGroup, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || group.label.toLowerCase().includes(needle) || group.instance.displayName.toLowerCase().includes(needle);
}
