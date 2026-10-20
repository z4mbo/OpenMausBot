import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ModelHostSourceState {
  sourceKey: string;
  sourceId?: string;
  instanceId: string;
  provider: string;
  label: string;
  billing: "subscription" | "metered" | "unknown";
  models: string[];
  enabled: boolean;
  projectIds: string[];
  workspaceHead: boolean;
  capacity: number;
}

export interface ModelHostAccountState {
  origin: string;
  userId: string;
  teamId: string;
  hostId: string;
  hostToken: string;
  sources: Record<string, ModelHostSourceState>;
}

interface State {
  version: 1;
  deviceId: string;
  accounts: Record<string, ModelHostAccountState>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9]{1,64}$/;
const record = (input: unknown): Record<string, unknown> | undefined => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
const text = (input: unknown, max: number): input is string => typeof input === "string" && input.length > 0 && input.length <= max && !/[\p{Cc}\p{Cf}]/u.test(input);
const ids = (input: unknown): input is string[] => Array.isArray(input) && input.length <= 100 && new Set(input).size === input.length && input.every(value => typeof value === "string" && ID.test(value));
const models = (input: unknown): input is string[] => Array.isArray(input) && input.length <= 100 && new Set(input).size === input.length && input.every(value => text(value, 200));
const invalid = () => new Error("Origin model hosting state cannot be read safely. Restore its local settings before enabling hosting.");

export function modelHostOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(url.protocol === "https:" || url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw invalid();
  return url.origin;
}

export function modelHostAccountKey(origin: string, userId: string, teamId: string): string {
  if (!ID.test(userId) || !ID.test(teamId)) throw invalid();
  return createHash("sha256").update(JSON.stringify([modelHostOrigin(origin), userId, teamId])).digest("hex");
}

function validSource(value: unknown): value is ModelHostSourceState {
  const source = record(value);
  return Boolean(source && typeof source.sourceKey === "string" && UUID.test(source.sourceKey) &&
    (source.sourceId === undefined || typeof source.sourceId === "string" && ID.test(source.sourceId)) && text(source.instanceId, 200) &&
    text(source.provider, 80) && text(source.label, 80) && ["subscription", "metered", "unknown"].includes(String(source.billing)) &&
    models(source.models) && typeof source.enabled === "boolean" && ids(source.projectIds) && typeof source.workspaceHead === "boolean" &&
    Number.isInteger(source.capacity) && Number(source.capacity) >= 1 && Number(source.capacity) <= 8);
}

function validAccount(value: unknown): value is ModelHostAccountState {
  const account = record(value), sources = record(account?.sources);
  if (!account || !sources || !text(account.origin, 500) || !text(account.userId, 64) || !ID.test(account.userId) ||
      !text(account.teamId, 64) || !ID.test(account.teamId) || !text(account.hostId, 64) || !ID.test(account.hostId) ||
      typeof account.hostToken !== "string" || !/^[a-f0-9]{64}$/.test(account.hostToken) || Object.keys(sources).length > 20) return false;
  try { if (modelHostOrigin(account.origin) !== account.origin) return false; } catch { return false; }
  return Object.entries(sources).every(([key, source]) => validSource(source) && source.sourceKey === key);
}

export function createModelHostState(file: string) {
  let cached: State | undefined;
  const read = (): State => {
    if (cached) return cached;
    if (!existsSync(file)) return cached = { version: 1, deviceId: randomUUID(), accounts: {} };
    try {
      const state = record(JSON.parse(readFileSync(file, "utf8"))), accounts = record(state?.accounts);
      if (!state || state.version !== 1 || typeof state.deviceId !== "string" || !UUID.test(state.deviceId) || !accounts || Object.keys(accounts).length > 100) throw invalid();
      for (const [key, account] of Object.entries(accounts)) {
        if (!validAccount(account) || modelHostAccountKey(account.origin, account.userId, account.teamId) !== key) throw invalid();
      }
      return cached = state as unknown as State;
    } catch { throw invalid(); }
  };
  const save = (next: State): void => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const partial = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(partial, JSON.stringify(next, null, 2), { flag: "wx", mode: 0o600 });
      renameSync(partial, file);
      cached = next;
    } catch (error) {
      try { unlinkSync(partial); } catch {}
      throw error;
    }
  };
  return {
    deviceId(): string { const state = read(); if (!existsSync(file)) save(state); return state.deviceId; },
    account(origin: string, userId: string, teamId: string): ModelHostAccountState | undefined {
      return structuredClone(read().accounts[modelHostAccountKey(origin, userId, teamId)]);
    },
    accounts(): ModelHostAccountState[] { return structuredClone(Object.values(read().accounts)); },
    put(account: ModelHostAccountState): void {
      if (!validAccount(account)) throw invalid();
      const state = read(), key = modelHostAccountKey(account.origin, account.userId, account.teamId);
      save({ ...state, accounts: { ...state.accounts, [key]: structuredClone(account) } });
    },
  };
}
