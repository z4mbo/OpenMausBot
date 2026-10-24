import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, InstanceInfo } from "@/state/store";

// Hook-by-call-order harness: the picker's own state survives between renders, effects never run, and handlers are read
// off the element tree.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {
    values: [] as unknown[],
    index: 0,
    own: 0,
    instances: [] as InstanceInfo[],
    bots: [] as Bot[],
    dispatch: (() => {}) as (...args: unknown[]) => void,
  };
});
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: () => {},
}));
vi.mock("./MenuMotion", () => ({ useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "" }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: fixture.bots, modelVariantSessions: {}, config: {} },
    dispatch: fixture.dispatch,
    refreshInstances: () => Promise.resolve(),
    refreshModels: () => Promise.resolve(),
  }),
}));

const { FollowBotModelRow, ModelPicker, ScopeSegments } = await import("./ModelPicker");
const { ModelPickerList } = await import("./ModelPickerList");

afterAll(() => vi.unstubAllGlobals());

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    return [node, ...nodes(node.props.children)];
  });
}

const claude: InstanceInfo = {
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription",
  snapshot: { state: "available", version: "2.1.300", authenticated: true },
  models: { default: "claude-opus-5-5", options: [
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  ] },
};
const opus = { instanceId: "claude", model: "claude-opus-5-5" };
const haiku = { instanceId: "claude", model: "claude-haiku-4-5-20251001" };

function scout(threadModel: typeof opus | null, others: Array<{ threadId: string; model: typeof opus | null }> = []): Bot {
  const profile: Bot = {
    id: "scout", threadId: "thread-scout", name: "Scout", title: "", description: "", notifications: true,
    color: "green", unread: false, messages: [], modelSelection: opus,
    tasks: [
      { threadId: "thread-scout", title: "This one", createdAt: 1, modelSelection: threadModel ?? opus, followsBotModel: threadModel === null },
      ...others.map(({ threadId, model }) => ({ threadId, title: threadId, createdAt: 1, modelSelection: model ?? opus, followsBotModel: model === null })),
    ],
  };
  fixture.bots = [profile];
  return { ...profile, modelSelection: threadModel ?? opus };
}

function render(forBot: Bot) {
  fixture.values.length = Math.min(fixture.values.length, fixture.own);
  let tree: ReactNode = null;
  function Capture() {
    fixture.index = 0;
    tree = ModelPicker({ bot: forBot, threadId: forBot.threadId });
    fixture.own = fixture.index;
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}

function open(forBot: Bot) {
  const trigger = render(forBot).nodes.find((node) => node.props["data-tour"] === "model")!;
  (trigger.props.onClick as () => void)();
  return render(forBot);
}

const menu = (html: string) => html.slice(html.indexOf("data-model-picker-content"));
const list = (rendered: ReturnType<typeof render>) => rendered.nodes.find((node) => node.type === ModelPickerList)!;
const followRow = (rendered: ReturnType<typeof render>) => {
  const lead = list(rendered).props.lead as Node | undefined;
  return lead?.type === FollowBotModelRow ? lead : undefined;
};
const pick = (rendered: ReturnType<typeof render>, model: string) => (list(rendered).props.onPick as (instance: InstanceInfo, model: string) => void)(claude, model);
const scope = (rendered: ReturnType<typeof render>, value: "thread" | "bot") =>
  (rendered.nodes.find((node) => node.type === ScopeSegments)!.props.onScope as (scope: "thread" | "bot") => void)(value);

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.own = 0;
  fixture.instances = [claude];
  fixture.bots = [];
  fixture.dispatch = vi.fn();
});

describe("a thread's picker and its bot's model", () => {
  it("leads the list with the bot's model for a thread on its own, and picking it is a thread-only pick", () => {
    const opened = open(scout(haiku));
    expect(followRow(opened)!.props.follows).toBe(false);
    expect(list(opened).props.botModel).toEqual(opus);
    expect(menu(opened.html)).toContain("Use Scout&#x27;s model");
    expect(menu(opened.html)).toContain("Claude · Opus 5.5");
    (followRow(opened)!.props.onPick as () => void)();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({
      type: "setModel", botId: "scout", threadId: "thread-scout", updateBotDefault: false, selection: opus,
    });
  });

  it("shows a thread that follows its bot as following, and picking the bot's model again changes nothing", () => {
    const opened = open(scout(null));
    expect(followRow(opened)!.props.follows).toBe(true);
    expect(render(scout(null)).nodes.find((node) => node.props["data-tour"] === "model")!.props.title).toContain("Uses Scout's model");
    (followRow(opened)!.props.onPick as () => void)();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("offers nothing a server too old to say whether a thread follows its bot could not do", () => {
    const forBot = scout(null);
    fixture.bots = [];
    const opened = open({ ...forBot, tasks: undefined });
    expect(followRow(opened)).toBeUndefined();
    expect(list(opened).props.botModel).toBeUndefined();
  });

  it("changes only this thread unless asked, then the bot's default too", () => {
    const forBot = scout(null);
    let opened = open(forBot);
    expect(opened.html).toContain("Only this thread");
    pick(opened, "claude-sonnet-5-5");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "setModel", updateBotDefault: false }));
    opened = open(forBot);
    scope(opened, "bot");
    pick(render(forBot), "claude-sonnet-5-5");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "setModel", updateBotDefault: true }));
  });

  it("right after a pick changes the bot's model, says how many threads keep their own, until it opens again", () => {
    const forBot = scout(null, [{ threadId: "kept", model: haiku }, { threadId: "follows", model: null }]);
    const opened = open(forBot);
    scope(opened, "bot");
    pick(render(forBot), "claude-sonnet-5-5");
    const closed = render(forBot);
    expect(closed.html).toContain("data-thread-models-notice");
    expect(closed.html).toContain("1 thread uses its own model.");
    expect(closed.html).toContain("Switch it too");
    open(forBot);
    expect(render(forBot).html).not.toContain("data-thread-models-notice");
  });

  it("says nothing after a bot model change when every thread follows the bot", () => {
    const forBot = scout(null, [{ threadId: "follows", model: null }]);
    scope(open(forBot), "bot");
    pick(render(forBot), "claude-sonnet-5-5");
    expect(render(forBot).html).not.toContain("data-thread-models-notice");
  });
});
