export type BudgetLevel = "ok" | "warn" | "over";

export interface BudgetLine { spentUsd: number; runs: number; monthlyUsd?: number }

export interface BudgetOverview {
  month: string;
  canEdit: boolean;
  agents: (BudgetLine & { agentId: string })[];
  projects: (BudgetLine & { projectId: string })[];
}

export interface AgentBudget {
  scope: "agent" | "project";
  name: string;
  spentUsd: number;
  monthlyUsd: number;
  level: BudgetLevel;
  canRaise: boolean;
  teamId: string;
  projectId?: string;
}

export const WARN_RATIO = 0.8;
export const BUDGET_MAX_USD = 100_000;

export function budgetLevel(spentUsd: number, monthlyUsd: number | undefined): BudgetLevel {
  if (monthlyUsd === undefined) return "ok";
  if (spentUsd >= monthlyUsd) return "over";
  return spentUsd >= monthlyUsd * WARN_RATIO ? "warn" : "ok";
}

export function formatUsd(usd: number): string {
  return usd >= 1_000
    ? `$${Math.round(usd).toLocaleString("en-US")}`
    : `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
}

/** Blank clears the budget; anything else must be a dollar amount from $1 up. */
export function parseBudgetInput(value: string): number | null | "invalid" {
  const clean = value.replace(/[$,\s]/g, "");
  if (!clean) return null;
  const amount = Number(clean);
  if (!Number.isFinite(amount) || amount < 1 || amount > BUDGET_MAX_USD) return "invalid";
  return Math.round(amount * 100) / 100;
}

export function budgetCaption(line: BudgetLine | undefined): string {
  if (!line) return "";
  if (line.monthlyUsd !== undefined) return `${formatUsd(line.spentUsd)} of ${formatUsd(line.monthlyUsd)} this month`;
  return line.spentUsd > 0 ? `${formatUsd(line.spentUsd)} this month` : "";
}

export function budgetPercent(line: Pick<BudgetLine, "spentUsd" | "monthlyUsd">): number | null {
  return line.monthlyUsd ? Math.round((line.spentUsd / line.monthlyUsd) * 100) : null;
}
