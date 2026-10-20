import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ open: false, expanded: false, width: "standard", instances: [] as InstanceInfo[], toggle: vi.fn(), details: vi.fn(), resize: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial === null ? { left: 8, top: 80, width: 320, maxHeight: 500 } : initial, () => {}] }));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { instances: fixture.instances } }) }));
vi.mock("@/lib/chat-usage-preferences", () => ({ useChatUsageOpen: () => fixture.open, setChatUsageOpen: fixture.toggle, useChatContextDetails: () => fixture.expanded, setChatContextDetails: fixture.details }));
vi.mock("@/lib/chat-width", () => ({ CHAT_WIDTH_IDS: ["standard", "wide", "full"], useChatWidth: () => fixture.width, applyChatWidth: fixture.resize }));
vi.mock("./PlanUsage", () => ({ PlanUsage: ({ providerId }: { providerId: string }) => createElement("span", { "data-quota-provider": providerId }, "Actual quota component") }));

import { ChatContextDetails, ChatUsagePopover, chatUsagePosition } from "./ChatUsagePopover";

const bot = (): Bot => ({ id: "atlas", name: "Atlas", threadId: "thread", title: "", description: "", color: "green", messages: [], notifications: false, unread: false, modelSelection: { instanceId: "provider-one", model: "model-one" } });
type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap(child => isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []);
function render() {
  let tree: ReactNode = null;
  function Capture() { tree = ChatUsagePopover({ bot: bot(), messages: [] }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
beforeEach(() => { fixture.open = false; fixture.expanded = false; fixture.width = "standard"; fixture.instances = []; fixture.toggle.mockReset(); fixture.details.mockReset(); fixture.resize.mockReset(); vi.stubGlobal("document", { body: {} }); });
afterEach(() => vi.unstubAllGlobals());

describe("chat usage and context", () => {
  it("opens a persistent minimal panel for the active provider with width preferences left in Appearance", () => {
    const trigger = render().nodes.find(node => node.props["aria-haspopup"] === "dialog")!;
    (trigger.props.onClick as () => void)(); expect(fixture.toggle).toHaveBeenCalledWith(true);
    fixture.open = true;
    const view = render();
    expect(view.html).toContain('data-quota-provider="provider-one"');
    expect(view.html).toContain('aria-modal="false"');
    expect(view.html).toContain("model-one");
    expect(view.html).not.toContain("fieldset");
    expect(view.html).not.toContain("Medium");
    const escape = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (view.nodes.find(node => node.props.role === "dialog")!.props.onKeyDown as (event: unknown) => void)(escape);
    expect(fixture.toggle).toHaveBeenLastCalledWith(false);
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
  });

  it("uses a reported context window and never treats lifetime input tokens as current context", () => {
    const source = bot();
    source.tasks = [{ threadId: "thread", title: "Main", createdAt: 0, usage: { input: 900_000, output: 1_000, costUsd: null, turns: 8, context: { tokens: 20_000, window: 100_000 } } }];
    const html = renderToStaticMarkup(createElement(ChatContextDetails, { bot: source, messages: [] }));
    expect(html).toContain("20%"); expect(html).toContain("20k"); expect(html).toContain("100k");
    expect(html).toContain("Reported window size");
    expect(html).not.toContain("900%");
  });

  it("leaves unknown context unknown and discards readings made before compaction", () => {
    const source = bot();
    let html = renderToStaticMarkup(createElement(ChatContextDetails, { bot: source, messages: [] }));
    expect(html).toContain("Not reported"); expect(html).not.toContain("0%");
    source.tasks = [{ threadId: "thread", title: "Main", createdAt: 0, usage: { input: 900_000, output: 1_000, costUsd: null, turns: 8, context: { tokens: 90_000, window: 100_000 } } }];
    html = renderToStaticMarkup(createElement(ChatContextDetails, { bot: source, messages: [{ id: "compact", role: "bot", kind: "compaction", text: "Compacted", timestamp: 0 } as unknown as Message] }));
    expect(html).toContain("Waiting for a new context reading after compaction");
    expect(html).not.toContain("90%");
  });

  it("keeps the popup inside a 375px viewport and leaves room under a wrapping header", () => {
    const result = chatUsagePosition({ left: 0, right: 375, bottom: 142 }, { width: 375, height: 667 });
    expect(result.width).toBe(320); expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + result.width).toBeLessThanOrEqual(367);
    expect(result.top).toBe(150); expect(result.top + result.maxHeight).toBeLessThanOrEqual(659);
  });
});
