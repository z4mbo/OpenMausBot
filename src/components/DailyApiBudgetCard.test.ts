import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@/state/store";
import { DailyApiBudgetCard, DailyApiBudgetStatus, parseDailyApiLimit, type DailyApiBudgetReport } from "./DailyApiBudgetCard";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, owner: true, effects: [] as Array<() => (() => void)>, config: {} as ConfigStatus, api: vi.fn(), dispatch: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [fixture.values[index], (next: unknown) => { fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = fixture.index++; return fixture.values[index] ??= { current: initial }; },
  useEffect: (effect: () => (() => void), dependencies: unknown[]) => { if (dependencies.length === 0) fixture.effects.push(effect); },
}));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.owner }));

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap(child => isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []);
function render() {
  let tree: ReactNode = null;
  function Capture() { fixture.index = 0; tree = DailyApiBudgetCard(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture)), all = nodes(tree);
  return { html, all, find: (label: string) => all.find(node => node.props["aria-label"] === label)!, form: all.find(node => node.type === "form")!, save: all.find(node => node.props.type === "submit")! };
}
const choose = (node: Node, value: string) => (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
const submit = () => (render().form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

beforeEach(() => {
  fixture.values = []; fixture.effects = []; fixture.owner = true;
  fixture.config = {} as ConfigStatus;
  fixture.api.mockReset();
  fixture.dispatch.mockReset().mockImplementation(({ config }: { config: ConfigStatus }) => { fixture.config = config; });
});

describe("DailyApiBudgetCard", () => {
  it("shows the computer-only scope without enterprise gating and preserves zero as a blocking cap", async () => {
    expect(render().html).toContain("all agents on this computer");
    expect(render().html).toContain("Zero blocks paid API work");
    expect(render().html).toContain("reviewed OpenAI models");
    expect(render().html).toContain("Other paid routes are blocked");
    expect(render().html).toContain("Maximum context and output costs are reserved");
    choose(render().find("Daily limit in USD"), "0");
    choose(render().find("Day resets in this time zone"), "UTC");
    fixture.api.mockResolvedValueOnce({ dailyApiBudget: { limitUsd: 0, timeZone: "UTC" } });
    submit(); await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ dailyApiBudget: { limitUsd: 0, timeZone: "UTC" } }), signal: expect.any(AbortSignal) });
    expect(render().save.props.disabled).toBe(true);
  });

  it("preserves a failed save and clears a limit with null rather than treating zero as off", async () => {
    fixture.config = { dailyApiBudget: { limitUsd: 4, timeZone: "Europe/Rome" } } as ConfigStatus;
    choose(render().find("Daily limit in USD"), "2.50");
    fixture.api.mockRejectedValueOnce(new Error("Fixture budget save failed"));
    submit(); await flush();
    expect(render().html).toContain("Fixture budget save failed");
    expect(render().find("Daily limit in USD").props.value).toBe("2.50");
    choose(render().find("Daily limit in USD"), "");
    fixture.api.mockResolvedValueOnce({});
    submit(); await flush();
    expect(fixture.api.mock.calls[1][1].body).toBe('{"dailyApiBudget":null}');
  });

  it("keeps invalid caps local and prevents non-owner writes", () => {
    choose(render().find("Daily limit in USD"), "-1"); submit();
    expect(render().html).toContain("Enter a daily USD limit");
    expect(fixture.api).not.toHaveBeenCalled();
    fixture.owner = false;
    expect(render().save.props.disabled).toBe(true);
    expect(render().find("Daily limit in USD").props.disabled).toBe(true);
    submit(); expect(fixture.api).not.toHaveBeenCalled();
  });

  it("aborts a closing card's save and ignores late configuration responses", async () => {
    choose(render().find("Daily limit in USD"), "2");
    let resolve!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const cleanup = fixture.effects[0]();
    submit(); const signal = fixture.api.mock.calls[0][1].signal as AbortSignal;
    cleanup(); expect(signal.aborted).toBe(true);
    resolve({ dailyApiBudget: { limitUsd: 2, timeZone: "UTC" } }); await flush();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("distinguishes disabled, zero, invalid and finite money inputs", () => {
    expect(parseDailyApiLimit(" ")).toBeNull();
    expect(parseDailyApiLimit("0")).toBe(0);
    expect(parseDailyApiLimit("0.25")).toBe(0.25);
    for (const value of ["-1", "NaN", "Infinity", "1000001", "0x10", "1e2"]) expect(parseDailyApiLimit(value)).toBeUndefined();
  });

  it("uses server reset metadata and preserves bounded unknown costs as reservations rather than inventing a block", () => {
    const report: DailyApiBudgetReport = { timeZone: "UTC", day: "2026-10-20", resetsAt: "2026-10-21T00:00:00Z", spentUsd: 1, reservedUsd: 2, unknownCost: true, global: { limitUsd: 4, remainingUsd: 1, exceeded: false }, agents: [] };
    const html = renderToStaticMarkup(createElement(DailyApiBudgetStatus, { report }));
    expect(html).toContain("reserved");
    expect(html).toContain("(UTC)");
    expect(html).toContain("not final");
    expect(html).toContain("reserved maximum stays held");
    expect(html).not.toContain("paid work is blocked");
    expect(html).not.toContain("100% left");
    const missing = renderToStaticMarkup(createElement(DailyApiBudgetStatus, { report, botId: "missing" }));
    expect(missing).toContain("No spending report");
    expect(missing).not.toContain("$0");
    const capped = renderToStaticMarkup(createElement(DailyApiBudgetStatus, { report: { ...report, global: { limitUsd: 0, remainingUsd: 0, exceeded: true } } }));
    expect(capped).toContain("Daily API budget reached");
    expect(capped).toContain("paid work is blocked");
  });
});
