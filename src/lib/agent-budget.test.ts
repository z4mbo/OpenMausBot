import { describe, expect, it } from "vitest";
import { budgetCaption, budgetLevel, budgetPercent, formatUsd, parseBudgetInput } from "./agent-budget";

describe("agent budgets", () => {
  it("warns from 80% and stops at 100%", () => {
    expect(budgetLevel(7.9, 10)).toBe("ok");
    expect(budgetLevel(8, 10)).toBe("warn");
    expect(budgetLevel(10, 10)).toBe("over");
    expect(budgetLevel(500, undefined)).toBe("ok");
  });

  it("writes dollars short", () => {
    expect(formatUsd(50)).toBe("$50");
    expect(formatUsd(12.3)).toBe("$12.30");
    expect(formatUsd(0.042)).toBe("$0.04");
    expect(formatUsd(2500)).toBe("$2,500");
  });

  it("reads a budget from what a person types", () => {
    expect(parseBudgetInput("")).toBeNull();
    expect(parseBudgetInput(" $1,250.505 ")).toBe(1250.51);
    expect(parseBudgetInput("0.5")).toBe("invalid");
    expect(parseBudgetInput("abc")).toBe("invalid");
    expect(parseBudgetInput("200000")).toBe("invalid");
  });

  it("captions spend with and without a budget", () => {
    expect(budgetCaption({ spentUsd: 4, runs: 2, monthlyUsd: 10 })).toBe("$4 of $10 this month");
    expect(budgetCaption({ spentUsd: 1.5, runs: 1 })).toBe("$1.50 this month");
    expect(budgetCaption({ spentUsd: 0, runs: 0 })).toBe("");
    expect(budgetCaption(undefined)).toBe("");
    expect(budgetPercent({ spentUsd: 9, monthlyUsd: 10 })).toBe(90);
  });
});
