import { DATA_DIR } from "./config.ts";
import { dailyApiBudgetForDataDir } from "./daily-api-budget.ts";

export function dailyBudgetSettingsConflict(
  next: { limitUsd: number; timeZone: string } | null | undefined,
  current: { limitUsd: number; timeZone: string } | undefined,
  busy: boolean,
): string | undefined {
  if (!next) return undefined;
  if (!current && busy) return "Stop active agents before enabling this computer's daily API budget.";
  if (!dailyApiBudgetForDataDir(DATA_DIR).timeZoneChangeAllowed(next.timeZone)) {
    return "Keep the current budget timezone until 36 hours after API spending or reservations in another timezone. Changing it now could reset the daily allowance.";
  }
  return undefined;
}

export function agentDailyBudgetConflict(next: unknown, current: number | undefined, busy: boolean): string | undefined {
  return typeof next === "number" && current === undefined && busy
    ? "Stop this agent's active turns before enabling its daily API budget."
    : undefined;
}
