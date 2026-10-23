// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBudget } from "@/lib/agent-budget";
import type { SharedBotLink } from "../../shared/wire";

const fixture = vi.hoisted(() => ({ budget: null as AgentBudget | null, mutate: vi.fn() }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: () => fixture.budget, cloudMutation: fixture.mutate }));
const { AgentBudgetPill } = await import("./AgentBudgetPill");
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => { if (root) flushSync(() => root!.unmount()); root = undefined; host?.remove(); fixture.mutate.mockReset(); });

function show(canRaise: boolean) {
  fixture.budget = { scope: "agent", name: "Ada", spentUsd: 10, monthlyUsd: 10, level: "over", canRaise, teamId: "team" };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(createElement(AgentBudgetPill, { shared: { agentId: "ada" } as SharedBotLink })));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Monthly budget details"]');
  expect(trigger).not.toBeNull();
  flushSync(() => trigger!.click());
  return trigger!;
}

describe("compact agent monthly budget", () => {
  it("keeps monthly status and the admin editor available from its compact control", () => {
    const trigger = show(true);
    let panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Monthly budget"]')!;
    expect(panel.textContent).toContain("Ada's budget is used up");
    expect(panel.textContent).toContain("$10 of $10 this month");
    const raise = [...panel.querySelectorAll("button")].find(button => button.textContent === "Raise budget")!;
    flushSync(() => raise.click());
    panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Monthly budget"]')!;
    expect(panel.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe("10");
    flushSync(() => [...panel.querySelectorAll("button")].find(button => button.textContent === "Cancel")!.click());
    expect(document.querySelector('[role="dialog"][aria-label="Monthly budget"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(fixture.mutate).not.toHaveBeenCalled();
  });

  it("gives non-admins the same details without a raise action and restores focus on Escape", () => {
    const trigger = show(false);
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Monthly budget"]')!;
    expect(panel.textContent).toContain("$10 of $10 this month");
    expect(panel.textContent).not.toContain("Raise budget");
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"][aria-label="Monthly budget"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses details on an outside pointer without changing the budget", () => {
    show(true);
    flushSync(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="dialog"][aria-label="Monthly budget"]')).toBeNull();
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
});
