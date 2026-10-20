import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BROADCAST_CHANNELS, BROADCAST_RULES, type BroadcastAccount } from "../../shared/broadcast.ts";
import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import { INTEGRATIONS, integrationKey, integrationStatuses, type IntegrationValues } from "../integration-keys.ts";

export type SocialIntegration = BroadcastAccount["integration"];

/** Security: secret values never leave the server; list() returns no values at all. */
export type { BroadcastAccount };

type StoredAccount = {
  id: string;
  integration: SocialIntegration;
  label: string;
  projectIds?: string[];
  values: Record<string, string>;
  createdAt: number;
};
type AccountInput = { integration: SocialIntegration; label: string; projectIds?: string[]; fields: Record<string, string> };
type KeyReader = (id: SocialIntegration, projectId?: string) => Record<string, string | undefined> | null;
const SOCIAL_INTEGRATIONS: readonly SocialIntegration[] = ["x", "bluesky", "linkedin", "meta", "tiktok"];
const memberKeys: KeyReader = (id, projectId) => integrationKey(id, undefined, projectId);
const isIntegration = (id: unknown): id is SocialIntegration => SOCIAL_INTEGRATIONS.includes(id as SocialIntegration);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validProjects = (value: unknown): value is string[] => Array.isArray(value) && value.every((id) => typeof id === "string" && Boolean(id.trim()) && !/[\0\r\n]/.test(id));

function validateFields(integration: SocialIntegration, fields: unknown): { values: Record<string, string> } | { error: string } {
  if (!isRecord(fields)) return { error: "fields must be an object" };
  const known: Record<string, { label: string; optional?: true }> = INTEGRATIONS[integration].fields;
  const values: Record<string, string> = {};
  for (const [name, raw] of Object.entries(fields)) {
    if (!Object.hasOwn(known, name)) return { error: `${INTEGRATIONS[integration].label} has no field ${name.slice(0, 40)}` };
    if (typeof raw !== "string") return { error: `${known[name]!.label} must be text` };
    const value = raw.trim();
    if (value.length > 4_096 || /[\0\r\n]/.test(raw)) return { error: `${known[name]!.label} doesn't look right. Paste only the value.` };
    if (value) values[name] = value;
  }
  for (const [name, field] of Object.entries(known)) {
    if (!field.optional && !values[name]) return { error: `${field.label} is required` };
  }
  return { values };
}

function readAccounts(file: string): StoredAccount[] {
  try {
    const stored: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(stored) || !Array.isArray(stored.accounts)) return [];
    return stored.accounts.flatMap((account: unknown) => {
      if (!isRecord(account) || typeof account.id !== "string" || !account.id || account.id === "default" || !isIntegration(account.integration)
        || typeof account.label !== "string" || !account.label.trim() || account.label.length > 60 || /[\0\r\n]/.test(account.label)
        || typeof account.createdAt !== "number" || !Number.isFinite(account.createdAt)
        || (account.projectIds !== undefined && !validProjects(account.projectIds))) return [];
      const checked = validateFields(account.integration, account.values);
      return "error" in checked ? [] : [{
        id: account.id, integration: account.integration, label: account.label, values: checked.values, createdAt: account.createdAt,
        ...(account.projectIds !== undefined ? { projectIds: [...account.projectIds] } : {}),
      }];
    });
  } catch {
    return [];
  }
}

function publicAccount(account: Pick<StoredAccount, "id" | "integration" | "label" | "projectIds">, source: BroadcastAccount["source"] = "yours"): BroadcastAccount {
  return {
    id: account.id, integration: account.integration, label: account.label,
    channels: BROADCAST_CHANNELS.filter((channel) => BROADCAST_RULES[channel].integration === account.integration),
    isDefault: account.id === "default", projectIds: account.projectIds ? [...account.projectIds] : null, source,
  };
}

function defaultLabel(integration: SocialIntegration, values: Record<string, string | undefined>): string {
  if (integration === "bluesky") return `@${values.handle?.replace(/^@/, "") ?? ""}`;
  if (integration === "linkedin") return values.authorUrn?.split(":").pop() || INTEGRATIONS.linkedin.label;
  if (integration === "meta" && values.facebookPageId) return `Page ${values.facebookPageId}`;
  return "Main account";
}

export function createBroadcastAccounts(file = join(DATA_DIR, "broadcast-accounts.json"), keys: KeyReader = memberKeys) {
  const write = (accounts: StoredAccount[]) => writeFileAtomic(file, `${JSON.stringify({ accounts }, null, 2)}\n`, { mode: 0o600 });
  return {
    list(projectId?: string): BroadcastAccount[] {
      const statuses = keys === memberKeys ? integrationStatuses(undefined, { projectId }) : [];
      const defaults = SOCIAL_INTEGRATIONS.flatMap((integration) => {
        const values = keys(integration, projectId);
        return values ? [publicAccount({ id: "default", integration, label: defaultLabel(integration, values) },
          statuses.find((status) => status.id === integration)?.source ?? "yours")] : [];
      });
      return [...defaults, ...readAccounts(file).filter((account) => projectId === undefined || !account.projectIds || account.projectIds.includes(projectId)).map((account) => publicAccount(account))];
    },
    add(input: AccountInput): { ok: true; account: BroadcastAccount } | { ok: false; error: string } {
      if (!input || !isIntegration(input.integration)) return { ok: false, error: "No such social integration" };
      const label = typeof input.label === "string" ? input.label.trim() : "";
      if (!label || label.length > 60 || /[\0\r\n]/.test(input.label)) return { ok: false, error: "label must be 1 to 60 characters" };
      if (input.projectIds !== undefined && !validProjects(input.projectIds)) return { ok: false, error: "projectIds must be an array of project ids" };
      const checked = validateFields(input.integration, input.fields);
      if ("error" in checked) return { ok: false, error: checked.error };
      const accounts = readAccounts(file);
      if (accounts.filter((account) => account.integration === input.integration).length >= 10) return { ok: false, error: "Connect up to 10 extra accounts per integration" };
      const account: StoredAccount = {
        id: randomUUID(), integration: input.integration, label, values: checked.values, createdAt: Date.now(),
        ...(input.projectIds !== undefined ? { projectIds: [...new Set(input.projectIds)] } : {}),
      };
      write([...accounts, account]);
      return { ok: true, account: publicAccount(account) };
    },
    remove(id: string): boolean {
      const accounts = readAccounts(file);
      const remaining = accounts.filter((account) => account.id !== id);
      if (remaining.length === accounts.length) return false;
      write(remaining);
      return true;
    },
    keys<I extends SocialIntegration>(integration: I, accountId?: string, projectId?: string): IntegrationValues<I> | null {
      if (accountId === undefined || accountId === "default") return keys(integration, projectId) as IntegrationValues<I> | null;
      const account = readAccounts(file).find((item) => item.id === accountId && item.integration === integration);
      if (!account || (projectId !== undefined && account.projectIds && !account.projectIds.includes(projectId))) return null;
      return account.values as IntegrationValues<I>;
    },
  };
}
