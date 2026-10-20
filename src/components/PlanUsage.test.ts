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
    expect(html).toContain("32% used");
    expect(html).toContain("70% used");
    expect(html).toContain("Not reported");
    expect(html).not.toContain("100% left");
    expect(html).toContain('aria-valuenow="32"');
    expect(html).toContain('aria-valuenow="70"');
  });

  it("shows an unavailable usage check without treating model access as broken or inventing zero usage", () => {
    fixture.report = { providers: [{ id: "fixture", name: "Fixture provider", ok: false, error: "Plan usage is unavailable for this account." }] };
    const html = renderToStaticMarkup(createElement(PlanUsage));
    expect(html).toContain('title="Plan usage is unavailable for this account."');
    expect(html).toContain("Usage unavailable");
    expect(html).not.toContain("Sign in again");
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

  it("shows only the selected model source inside the compact chat panel", () => {
    fixture.report = { providers: [{ id: "first", name: "First account", ok: false, error: "First allowance unavailable" }, { id: "second", name: "Second account", ok: false, error: "Second allowance unavailable" }] };
    const html = renderToStaticMarkup(createElement(PlanUsage, { providerId: "second", compact: true }));
    expect(html).toContain("Second account");
    expect(html).not.toContain("First account");
    expect(html).not.toContain('role="meter"');
    const missing = renderToStaticMarkup(createElement(PlanUsage, { providerId: "remote-source", compact: true }));
    expect(missing).toContain("Usage unavailable");
    expect(missing).not.toContain("100% left");
  });

  it("keeps compact usage to real session and weekly bars with no account explanation or width editor", () => {
    fixture.report = { providers: [{ id: "fixture", name: "Claude", plan: "Pro", ok: true, extra: [], fiveHour: { available: true, usedPercent: 32, remainingPercent: 68, resetsAt: new Date(Date.now() + 7_200_000).toISOString() }, weekly: { available: false, usedPercent: null, remainingPercent: null, resetsAt: null } }] };
    const html = renderToStaticMarkup(createElement(PlanUsage, { providerId: "fixture", compact: true }));
    expect(html).toContain("Current session"); expect(html).toContain("32% used"); expect(html).toMatch(/resets in (?:2h|1h 59m)/);
    expect(html.match(/role="meter"/g)).toHaveLength(1);
    expect(html).not.toContain("Models can keep working"); expect(html).not.toContain("API-key activity"); expect(html).not.toContain("fieldset");
  });

  it("keeps a reported overage visible while bounding its meter and leaves invalid usage unknown", () => {
    fixture.report = { providers: [{ id: "fixture", name: "Claude", plan: "Pro", ok: true, extra: [], fiveHour: { available: true, usedPercent: 112, remainingPercent: 0, resetsAt: null }, weekly: { available: true, usedPercent: -1, remainingPercent: null, resetsAt: null } }] };
    const html = renderToStaticMarkup(createElement(PlanUsage, { compact: true }));
    expect(html).toContain("112% used"); expect(html).toContain('aria-valuenow="100"'); expect(html).toContain("Not reported");
    expect(html.match(/role="meter"/g)).toHaveLength(1);
  });
});
