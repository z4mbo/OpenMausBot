import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { listPriceFor } from "./model-prices.ts";
import type { ModelPrice } from "./prices.ts";

export interface DailyApiBudgetPolicy {
  limitUsd?: number;
  agentLimitUsd?: number;
  timeZone: string;
}

export interface ApiBudgetUsage {
  input?: number;
  output?: number;
  cachedInput?: number;
  costUsd?: number;
}

export interface ApiBudgetRequestQuote {
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  maximumUsd: number;
  price: ModelPrice;
}

export interface ApiRequestBudgetLease {
  maxOutputTokens: number;
  price?: ModelPrice;
  settle(usage: ApiBudgetUsage | null): void;
  notDispatched(): void;
}

/** A metered driver must reserve before each bounded provider request and retain uncertain costs. */
export interface ApiRequestBudget {
  enabled?(): boolean;
  begin(input: { model: string; contextWindow: number | undefined; maxOutputTokens: number }): ApiRequestBudgetLease;
}

export interface DailyApiBudgetStatus {
  timeZone: string;
  day: string;
  resetsAt: string;
  spentUsd: number;
  reservedUsd: number;
  unknownCost: boolean;
  global?: { limitUsd: number; remainingUsd: number; exceeded: boolean };
  agents: Array<{ botId: string; spentUsd: number; reservedUsd: number; unknownCost: boolean; limitUsd?: number; remainingUsd?: number; exceeded: boolean }>;
}

export interface DailyApiBudgetReservation {
  requestId: string;
  reservedUsd: number;
  settle(costUsd: number | null): void;
  notDispatched(): void;
}

export interface DailyApiBudget {
  reserve(input: { requestId: string; botId: string; policy: DailyApiBudgetPolicy; maximumUsd: number }): DailyApiBudgetReservation;
  status(policy: Pick<DailyApiBudgetPolicy, "limitUsd" | "timeZone">, agents?: ReadonlyArray<{ botId: string; limitUsd?: number }>): DailyApiBudgetStatus;
  timeZoneChangeAllowed(timeZone: string): boolean;
  close(): void;
}

export class DailyApiBudgetError extends Error {
  readonly status = 409;
  readonly code = "daily_api_budget";
  constructor(message: string) { super(message); this.name = "DailyApiBudgetError"; }
}

export function dailyApiBudgetEnabled(policy: DailyApiBudgetPolicy): boolean {
  return policy.limitUsd !== undefined || policy.agentLimitUsd !== undefined;
}

const MICRO_USD = 1_000_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const budgets = new Map<string, DailyApiBudget>();

const MODEL_BOUNDS: Readonly<Record<string, { contextWindow: number; inputMultiplier: number; outputMultiplier: number; source: string }>> = Object.fromEntries([
  ["gpt-5.4-mini", 400_000, 1, 1],
  ["gpt-5.4", 1_050_000, 2, 1.5],
  ["gpt-5.5", 1_050_000, 2, 1.5],
  ["gpt-5.6-sol", 1_050_000, 2.5, 1.5],
  ["gpt-5.6-terra", 1_050_000, 2.5, 1.5],
  ["gpt-5.6-luna", 1_050_000, 2.5, 1.5],
  ["gpt-6-astra", 1_050_000, 2.5, 1.5],
].map(([model, contextWindow, inputMultiplier, outputMultiplier]) => [String(model), {
  contextWindow: Number(contextWindow), inputMultiplier: Number(inputMultiplier), outputMultiplier: Number(outputMultiplier), source: `https://developers.openai.com/api/docs/models/${model}`,
}]));

export function apiBudgetModelBound(model: string): { contextWindow: number; inputMultiplier: number; outputMultiplier: number; source: string; reviewedAt: string } | undefined {
  const bound = MODEL_BOUNDS[model.split("/").at(-1) ?? ""];
  return bound ? { ...bound, reviewedAt: "2026-10-19" } : undefined;
}

export function dailyApiBudgetForDataDir(dataDir: string): DailyApiBudget {
  const key = resolve(dataDir);
  let budget = budgets.get(key);
  if (!budget) {
    budget = createDailyApiBudget({ file: join(key, "usage", "daily-api-budget.sqlite") });
    budgets.set(key, budget);
  }
  return budget;
}

export function closeDailyApiBudgets(dataDir?: string): void {
  for (const [key, budget] of budgets) if (dataDir === undefined || key === resolve(dataDir)) {
    budget.close();
    budgets.delete(key);
  }
}

export function apiBudgetContextWindow(model: string, catalogWindow?: number): number | undefined {
  const known = apiBudgetModelBound(model)?.contextWindow;
  const catalog = typeof catalogWindow === "number" && Number.isSafeInteger(catalogWindow) && catalogWindow > 0 ? catalogWindow : undefined;
  return known && catalog ? Math.max(known, catalog) : known ?? catalog;
}

export function supportsApiRequestBudget(apiUrl: string): boolean {
  try {
    const url = new URL(apiUrl);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      ((url.hostname === "api.openai.com" && url.pathname.replace(/\/$/, "") === "/v1") ||
       (url.hostname === "openrouter.ai" && url.pathname.replace(/\/$/, "") === "/api/v1"));
  } catch { return false; }
}

export function boundedApiRequestBody(apiUrl: string, body: Record<string, unknown>, lease: ApiRequestBudgetLease): Record<string, unknown> {
  if (!supportsApiRequestBudget(apiUrl)) throw new DailyApiBudgetError("This API endpoint cannot enforce bounded requests under a daily API budget.");
  if (body.n !== undefined && body.n !== 1 || body.modalities !== undefined || body.plugins !== undefined || body.models !== undefined || body.prediction !== undefined || body.service_tier !== undefined && body.service_tier !== "default") {
    throw new DailyApiBudgetError("This API request has pricing that the daily API budget cannot bound.");
  }
  const bounded = { ...body, max_completion_tokens: lease.maxOutputTokens, service_tier: "default" };
  delete (bounded as Record<string, unknown>).max_tokens;
  if (new URL(apiUrl).hostname === "openrouter.ai") {
    const provider = body.provider && typeof body.provider === "object" && !Array.isArray(body.provider) ? body.provider as Record<string, unknown> : {};
    (bounded as Record<string, unknown>).provider = { ...provider, require_parameters: true,
      ...(lease.price ? { max_price: { prompt: lease.price.inputPerMillion, completion: lease.price.outputPerMillion, request: 0, image: 0 } } : {}) };
  }
  return bounded;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  let result = formatters.get(timeZone);
  if (!result) {
    try { result = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); }
    catch { throw new DailyApiBudgetError("Choose a valid timezone for the daily API budget."); }
    formatters.set(timeZone, result);
  }
  return result;
}

export function dailyApiBudgetDay(at: number, timeZone: string): string {
  if (!Number.isFinite(at)) throw new DailyApiBudgetError("The daily API budget clock is unavailable.");
  const parts = formatter(timeZone).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nextReset(at: number, timeZone: string): string {
  const day = dailyApiBudgetDay(at, timeZone);
  let lower = Math.floor(at), upper = lower + 36 * 3600_000;
  if (dailyApiBudgetDay(upper, timeZone) === day) throw new DailyApiBudgetError("The next daily API budget reset is unavailable.");
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (dailyApiBudgetDay(middle, timeZone) === day) lower = middle;
    else upper = middle;
  }
  return new Date(upper).toISOString();
}

function dayRange(at: number, timeZone: string): { day: string; start: number; end: number } {
  const day = dailyApiBudgetDay(at, timeZone);
  let lower = Math.floor(at) - 36 * 3600_000, upper = Math.floor(at);
  if (dailyApiBudgetDay(lower, timeZone) === day) throw new DailyApiBudgetError("The daily API budget day boundary is unavailable.");
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (dailyApiBudgetDay(middle, timeZone) === day) upper = middle;
    else lower = middle;
  }
  return { day, start: upper, end: Date.parse(nextReset(at, timeZone)) };
}

function micros(usd: number, reserve: boolean): number {
  if (!Number.isFinite(usd) || usd < 0 || usd > 1_000_000) throw new DailyApiBudgetError("The daily API budget amount must be a finite USD value between 0 and 1000000.");
  const [coefficient, exponent = "0"] = usd.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction), power = Number(exponent) - fraction.length + 6;
  if (power >= 0) return Number(digits * 10n ** BigInt(power));
  const divisor = 10n ** BigInt(-power);
  return Number(digits / divisor + (reserve && digits % divisor !== 0n ? 1n : 0n));
}

type Totals = { spent: number; held: number; unknown: number };

export function createDailyApiBudget(input: { file: string; now?: () => number }): DailyApiBudget {
  const now = input.now ?? Date.now;
  mkdirSync(dirname(input.file), { recursive: true, mode: 0o700 });
  const parent = lstatSync(dirname(input.file));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new DailyApiBudgetError("Daily API budget storage must be an owned directory.");
  if (existsSync(input.file)) {
    const existing = lstatSync(input.file);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new DailyApiBudgetError("Daily API budget storage must be an owned regular file.");
  }
  closeSync(openSync(input.file, "a", 0o600));
  const file = lstatSync(input.file);
  if (!file.isFile() || file.isSymbolicLink()) throw new DailyApiBudgetError("Daily API budget storage must be an owned regular file.");
  chmodSync(input.file, 0o600);
  const db = new DatabaseSync(input.file);
  try { db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS api_budget_requests (
      request_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, day TEXT NOT NULL, time_zone TEXT NOT NULL,
      reserved_micros INTEGER NOT NULL CHECK(reserved_micros >= 0), settled_micros INTEGER,
      state TEXT NOT NULL CHECK(state IN ('reserved','unknown','settled','released')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS api_budget_requests_day ON api_budget_requests(time_zone,day,bot_id);
    CREATE INDEX IF NOT EXISTS api_budget_requests_created ON api_budget_requests(created_at,bot_id);
    UPDATE api_budget_requests SET state='unknown' WHERE state='reserved';`); }
  catch (error) { db.close(); throw error; }
  const totals = (range: { start: number; end: number }, botId?: string): Totals => {
    const row = db.prepare(`SELECT COALESCE(SUM(CASE WHEN state='settled' THEN settled_micros ELSE 0 END),0) spent,
      COALESCE(SUM(CASE WHEN state IN ('reserved','unknown') THEN reserved_micros ELSE 0 END),0) held,
      COALESCE(SUM(CASE WHEN state='unknown' THEN 1 ELSE 0 END),0) unknown
      FROM api_budget_requests WHERE created_at>=? AND created_at<?${botId === undefined ? "" : " AND bot_id=?"}`).get(...(botId === undefined ? [range.start, range.end] : [range.start, range.end, botId])) as Totals;
    return row;
  };
  const finish = (requestId: string, kind: "settled" | "unknown" | "released", costUsd?: number) => {
    const cost = costUsd === undefined ? null : micros(costUsd, true);
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT state,settled_micros FROM api_budget_requests WHERE request_id=?").get(requestId) as { state: string; settled_micros: number | null } | undefined;
      if (!row) throw new DailyApiBudgetError("The daily API budget reservation is unavailable.");
      if (row.state === "settled" || row.state === "released") {
        if (row.state !== kind || (kind === "settled" && row.settled_micros !== cost)) throw new DailyApiBudgetError("The daily API budget request was already settled with a different outcome.");
      } else db.prepare("UPDATE api_budget_requests SET state=?,settled_micros=?,updated_at=? WHERE request_id=?").run(kind, cost, now(), requestId);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  let closed = false;
  return {
    reserve({ requestId, botId, policy, maximumUsd }) {
      if (!requestId || !botId) throw new DailyApiBudgetError("A daily API budget request and agent identity are required.");
      const reserved = micros(maximumUsd, true), at = now(), range = dayRange(at, policy.timeZone);
      const globalCap = policy.limitUsd === undefined ? undefined : micros(policy.limitUsd, false);
      const agentCap = policy.agentLimitUsd === undefined ? undefined : micros(policy.agentLimitUsd, false);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (db.prepare("SELECT 1 FROM api_budget_requests WHERE request_id=?").get(requestId)) throw new DailyApiBudgetError("This API request already has a budget reservation; it cannot be dispatched again.");
        const global = totals(range), agent = totals(range, botId);
        if (globalCap !== undefined && (globalCap === 0 || global.spent + global.held + reserved > globalCap)) throw new DailyApiBudgetError("The total daily API budget has insufficient room for this bounded request.");
        if (agentCap !== undefined && (agentCap === 0 || agent.spent + agent.held + reserved > agentCap)) throw new DailyApiBudgetError("This agent's daily API budget has insufficient room for this bounded request.");
        db.prepare("INSERT INTO api_budget_requests(request_id,bot_id,day,time_zone,reserved_micros,state,created_at,updated_at) VALUES(?,?,?,?,?,'reserved',?,?)").run(requestId, botId, range.day, policy.timeZone, reserved, at, at);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return { requestId, reservedUsd: reserved / MICRO_USD,
        settle: costUsd => finish(requestId, costUsd === null ? "unknown" : "settled", costUsd ?? undefined),
        notDispatched: () => finish(requestId, "released") };
    },
    status(policy, agents = []) {
      const at = now(), range = dayRange(at, policy.timeZone), all = totals(range);
      const ids = new Set([...agents.map(agent => agent.botId), ...(db.prepare("SELECT DISTINCT bot_id FROM api_budget_requests WHERE created_at>=? AND created_at<?").all(range.start, range.end) as { bot_id: string }[]).map(row => row.bot_id)]);
      const scope = (value: Totals, limitUsd: number | undefined) => ({
        ...(limitUsd === undefined ? {} : { limitUsd, remainingUsd: Math.max(0, micros(limitUsd, false) - value.spent - value.held) / MICRO_USD }),
        exceeded: limitUsd !== undefined && value.spent + value.held >= micros(limitUsd, false),
      });
      return { timeZone: policy.timeZone, day: range.day, resetsAt: new Date(range.end).toISOString(), spentUsd: all.spent / MICRO_USD, reservedUsd: all.held / MICRO_USD, unknownCost: all.unknown > 0,
        ...(policy.limitUsd === undefined ? {} : { global: scope(all, policy.limitUsd) as { limitUsd: number; remainingUsd: number; exceeded: boolean } }),
        agents: [...ids].sort().map(botId => { const value = totals(range, botId); return { botId, spentUsd: value.spent / MICRO_USD, reservedUsd: value.held / MICRO_USD, unknownCost: value.unknown > 0, ...scope(value, agents.find(agent => agent.botId === botId)?.limitUsd) }; }) };
    },
    timeZoneChangeAllowed(timeZone) {
      formatter(timeZone);
      return !db.prepare(`SELECT 1 FROM api_budget_requests WHERE created_at>=? AND time_zone<>?
        AND ((state='settled' AND settled_micros>0) OR (state IN ('reserved','unknown') AND reserved_micros>0)) LIMIT 1`).get(now() - 36 * 3600_000, timeZone);
    },
    close() { if (!closed) { db.close(); closed = true; } },
  };
}

export function quoteApiBudgetRequest(request: {
  model: string;
  contextWindow: number | undefined;
  maxOutputTokens: number;
}, options: { priceFor?: (model: string, at: Date) => ModelPrice | null; at?: Date } = {}): ApiBudgetRequestQuote {
  const bound = apiBudgetModelBound(request.model);
  const rawPrice = options.priceFor ? options.priceFor(request.model, options.at ?? new Date()) : bound ? listPriceFor(request.model, options.at) : null;
  const contextWindow = options.priceFor ? request.contextWindow : apiBudgetContextWindow(request.model, request.contextWindow);
  if (!rawPrice || !contextWindow || !Number.isSafeInteger(contextWindow) || contextWindow < 1 || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
    throw new DailyApiBudgetError("This API model has no known price and bounded request size. Choose a supported model or remove the daily API budget.");
  }
  const price = { ...rawPrice, inputPerMillion: rawPrice.inputPerMillion * (options.priceFor ? 1 : bound?.inputMultiplier ?? 1),
    outputPerMillion: rawPrice.outputPerMillion * (options.priceFor ? 1 : bound?.outputMultiplier ?? 1),
    ...(rawPrice.cachedInputPerMillion === undefined ? {} : { cachedInputPerMillion: rawPrice.cachedInputPerMillion * (options.priceFor ? 1 : bound?.inputMultiplier ?? 1) }) };
  for (const rate of [price.inputPerMillion, price.outputPerMillion, price.cachedInputPerMillion ?? price.inputPerMillion]) if (!Number.isFinite(rate) || rate < 0) throw new DailyApiBudgetError("This API model has no valid known price.");
  return { model: request.model, contextWindow, maxOutputTokens: request.maxOutputTokens, price,
    maximumUsd: (contextWindow * Math.max(price.inputPerMillion, price.cachedInputPerMillion ?? price.inputPerMillion) + request.maxOutputTokens * price.outputPerMillion) / MICRO_USD };
}

export function createApiRequestBudget(input: {
  budget: DailyApiBudget;
  botId: string;
  policy: DailyApiBudgetPolicy | (() => DailyApiBudgetPolicy);
  priceFor?: (model: string, at: Date) => ModelPrice | null;
  now?: () => number;
}): ApiRequestBudget {
  const policyNow = () => typeof input.policy === "function" ? input.policy() : input.policy;
  return { enabled: () => dailyApiBudgetEnabled(policyNow()), begin(request) {
    const policy = policyNow();
    if (!dailyApiBudgetEnabled(policy)) return { maxOutputTokens: request.maxOutputTokens, settle: () => {}, notDispatched: () => {} };
    const quote = quoteApiBudgetRequest(request, { priceFor: input.priceFor, at: new Date(input.now?.() ?? Date.now()) });
    const { price } = quote;
    const reservation = input.budget.reserve({ requestId: randomUUID(), botId: input.botId, policy,
      maximumUsd: quote.maximumUsd });
    return { maxOutputTokens: request.maxOutputTokens, price,
      settle(usage) {
        const reported = typeof usage?.costUsd === "number" && Number.isFinite(usage.costUsd) && usage.costUsd >= 0 ? usage.costUsd : 0;
        if (reported > reservation.reservedUsd) {
          reservation.settle(reported);
          throw new DailyApiBudgetError("The API provider exceeded its reserved request cost. Further automatic calls were stopped.");
        }
        if (!usage || !Number.isSafeInteger(usage.input) || !Number.isSafeInteger(usage.output) || (usage.input ?? -1) < 0 || (usage.output ?? -1) < 0 || (usage.cachedInput !== undefined && (!Number.isSafeInteger(usage.cachedInput) || usage.cachedInput < 0 || usage.cachedInput > (usage.input ?? 0)))) { reservation.settle(null); return; }
        const cached = Math.min(usage.input!, Math.max(0, usage.cachedInput ?? 0));
        const estimated = ((usage.input! - cached) * price.inputPerMillion + cached * (price.cachedInputPerMillion ?? price.inputPerMillion) + usage.output! * price.outputPerMillion) / MICRO_USD;
        reservation.settle(Math.max(estimated, reported));
        if (usage.input! > quote.contextWindow || usage.output! > request.maxOutputTokens || estimated > reservation.reservedUsd) throw new DailyApiBudgetError("The API provider exceeded its reserved request size. Further automatic calls were stopped.");
      },
      notDispatched: reservation.notDispatched };
  } };
}
