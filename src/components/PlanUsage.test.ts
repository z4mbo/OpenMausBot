import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ report: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial === null ? fixture.report : initial === true ? false : typeof initial === "function" ? (initial as () => unknown)() : initial, () => {}],
}));
vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { PlanUsage } from "./PlanUsage";

describe("Plan usage presentation", () => {
  it("distinguishes remaining account allowance, per-model usage, and unavailable windows", () => {
    fixture.report = {
      fetchedAt: "2026-10-02T09:00:00Z",
      providers: [{
        id: "fixture", name: "Fixture provider", driver: "claude", plan: "Pro", ok: true, error: null,
        fiveHour: { available: true, remainingPercent: 68, usedPercent: 32, resetsAt: null },
        weekly: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null }, extra: [],
        models: [{ name: "Sonnet", windows: [{ label: "Weekly", remainingPercent: 30, usedPercent: 70, resetsAt: null }] }],
      }],
    };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("68% left");
    expect(html).toContain("70% used");
    expect(html).toContain("Not reported by this plan");
    expect(html).not.toContain("100% left");
    expect(html).toContain('aria-valuenow="32"');
    expect(html).toContain('aria-valuenow="70"');
  });

  it("shows an unavailable usage check without treating model access as broken or inventing zero usage", () => {
    fixture.report = { providers: [{ id: "fixture", name: "Fixture provider", ok: false, error: "Plan usage is unavailable for this account." }] };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("Plan usage is unavailable for this account.");
    expect(html).toContain("Models can keep working when usage is unavailable");
    expect(html).toContain("API-key activity is shown in History.");
    expect(html).not.toContain("text-danger");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("100% left");
  });

  it("shows a neutral fallback when an older server returns no usage error detail", () => {
    fixture.report = { providers: [{ id: "fixture", name: "Fixture provider", ok: false, error: null }] };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain("Could not load plan usage.");
    expect(html).not.toContain("text-danger");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("100% left");
  });
});
