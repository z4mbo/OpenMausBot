import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import { ModelFallbackSettings, fallbackKey, moveFallback, paidApiInstance } from "./ModelFallbackSettings";
import { BotDailyApiBudgetField } from "./DailyApiBudgetCard";
import { Select } from "./Select";
import { Switch } from "./SettingsPrimitives";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, owner: true, creationDraft: false, effects: [] as Array<() => (() => void)>, bot: null as unknown as Bot, instances: [] as InstanceInfo[], api: vi.fn(), dispatch: vi.fn() }));
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
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { instances: fixture.instances, bots: [fixture.bot] }, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.owner }));
vi.mock("./bot-settings/BotEditorContext", () => ({ useBotEditor: () => ({ draft: fixture.creationDraft }) }));

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap(child => isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []);
function render(compact = false) {
  let tree: ReactNode = null;
  function Capture() { fixture.index = 0; tree = ModelFallbackSettings({ bot: fixture.bot, compact }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture)), all = nodes(tree);
  return { html, all, find: (label: string) => all.find(node => node.props["aria-label"] === label)!, button: (label: string) => all.find(node => node.type === "button" && node.props.children === label)!, switches: all.filter(node => node.type === Switch), rows: all.filter(node => node.type === "li") };
}
const click = (node: Node) => (node.props.onClick as () => void)();
const choose = (node: Node, value: string) => (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const pair = (model: string) => ({ instanceId: "local", model });
const savedNames = () => render().rows.map(row => row.props.children).flatMap(child => nodes(child as ReactNode)).filter(node => node.props.title).map(node => node.props.title);

function pointerGesture(model: string, pointerId = 1) {
  const list = { contains: (row: unknown) => Boolean(row), getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 160 }) };
  const document = { elementsFromPoint: vi.fn(() => [] as unknown[]) };
  const handle = { ownerDocument: document, focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() };
  const event = (x: number, y: number) => ({ pointerId, isPrimary: true, button: 0, clientX: x, clientY: y, currentTarget: handle, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  const element = () => render().find(`Drag Local account · ${model} to reorder`);
  const invoke = (name: string, value: unknown) => (element().props[name] as (event: unknown) => void)(value);
  const ol = render().all.find(node => node.type === "ol")!;
  (ol.props.ref as { current: unknown }).current = list;
  const pointAt = (key: string | null, ownList = true) => document.elementsFromPoint.mockReturnValue(key ? [{ closest: () => ({ dataset: { reorderKey: key }, closest: () => ownList ? list : {} }) }] : []);
  return { down: (x = 10, y = 10) => invoke("onPointerDown", event(x, y)), move: (x: number, y: number) => invoke("onPointerMove", event(x, y)), up: (x: number, y: number) => invoke("onPointerUp", event(x, y)), otherUp: () => invoke("onPointerUp", { ...event(10, 50), pointerId: pointerId + 1 }), cancel: () => invoke("onPointerCancel", event(10, 10)), lostCapture: () => invoke("onLostPointerCapture", event(10, 10)), pointAt, handle };
}

beforeEach(() => {
  fixture.values = []; fixture.effects = []; fixture.owner = true; fixture.creationDraft = false;
  fixture.bot = { id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: false, unread: false, color: "green", messages: [], modelSelection: pair("primary") };
  fixture.instances = [
    { instanceId: "local", driverKind: "codex", displayName: "Local account", snapshot: { state: "available", authenticated: true, billing: "subscription" }, models: { default: "primary", options: [{ id: "primary", label: "Primary" }, { id: "second", label: "Second" }, { id: "third", label: "Third" }] } },
    { instanceId: "paid", driverKind: "openai-compat", access: "api", displayName: "Paid API", snapshot: { state: "available", authenticated: true, billing: "metered" }, models: { default: "paid-model", options: [{ id: "paid-model", label: "Paid model" }] } },
  ];
  fixture.api.mockReset();
  fixture.dispatch.mockReset().mockImplementation(({ bot }: { bot?: Bot }) => { if (bot) fixture.bot = bot; });
});

describe("ModelFallbackSettings", () => {
  it("does not send persisted bot patches from an unfinished new-agent editor", () => {
    fixture.creationDraft = true;
    expect(render().html).toBe("");
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("starts collapsed in chat, leaves the primary model alone and hides paid choices until explicitly enabled", () => {
    expect(render(true).html).not.toContain("Ranked backup models");
    click(render(true).all.find(node => node.props["aria-expanded"] === false)!);
    const view = render(true);
    expect(view.html).toContain("Ranked backup models");
    expect(view.html).not.toContain('<option value="paid">');
    expect(view.switches.map(node => node.props.checked)).toEqual([false, false]);
    expect(fixture.bot.modelSelection).toEqual(pair("primary"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("adds two exact models on the same provider without duplicates or changing the primary", async () => {
    choose(render().find("Backup provider"), "local");
    choose(render().find("Backup model"), "second"); click(render().find("Add backup model"));
    choose(render().find("Backup model"), "third"); click(render().find("Add backup model"));
    expect(render().rows).toHaveLength(2);
    expect(render().html).not.toContain('<option value="second">');
    fixture.api.mockResolvedValueOnce({ bot: { ...fixture.bot, fallback: [pair("second"), pair("third")] } });
    click(render().button("Save")); await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/atlas", { method: "PATCH", body: JSON.stringify({ fallback: [pair("second"), pair("third")] }), signal: expect.any(AbortSignal) });
    expect(fixture.bot.modelSelection).toEqual(pair("primary"));
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "botPatched" }));
  });

  it("keeps all rows visible during pointer movement, reorders only on release and supports keyboard buttons and Escape", () => {
    fixture.bot.fallback = [pair("second"), pair("third")];
    click(render().find("Move Local account · Second down"));
    expect(savedNames()).toEqual(["Local account · Third", "Local account · Second"]);
    const gesture = pointerGesture("Second");
    gesture.down(); gesture.pointAt(fallbackKey(pair("third"))); gesture.move(10, 50);
    expect(savedNames()).toEqual(["Local account · Third", "Local account · Second"]);
    gesture.up(10, 50);
    expect(savedNames()).toEqual(["Local account · Second", "Local account · Third"]);
    expect(gesture.handle.setPointerCapture).toHaveBeenCalledWith(1);
    const cancelled = pointerGesture("Third"); cancelled.down(); cancelled.pointAt(fallbackKey(pair("second"))); cancelled.move(10, 50);
    const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (render().all.find(node => node.type === "section")!.props.onKeyDown as (event: unknown) => void)(event);
    cancelled.up(10, 50);
    expect(savedNames()).toEqual(["Local account · Second", "Local account · Third"]);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("preserves paid opt-in, quota switching and the cap draft after a failed single-flight save", async () => {
    click(render().switches[0]); click(render().switches[1]);
    expect(render().html).toContain('<option value="paid">');
    const field = render().all.find(node => node.type === BotDailyApiBudgetField)!;
    (field.props.onChange as (value: string) => void)("0");
    let reject!: (cause: Error) => void;
    fixture.api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    click(render().button("Save"));
    click(render().button("Saving…"));
    expect(fixture.api).toHaveBeenCalledOnce();
    reject(new Error("Fixture could not save")); await flush();
    expect(render().html).toContain("Fixture could not save");
    expect(render().switches.map(node => node.props.checked)).toEqual([true, true]);
    expect(render().all.find(node => node.type === BotDailyApiBudgetField)!.props.value).toBe("0");
    fixture.api.mockResolvedValueOnce({ bot: { ...fixture.bot, quotaFallback: true, fallbackApiAllowed: true, dailyApiBudgetUsd: 0 } });
    click(render().button("Save")); await flush();
    expect(fixture.api.mock.calls[1][1].body).toContain('"dailyApiBudgetUsd":0');
    expect(render().button("Save").props.disabled).toBe(true);
  });

  it("keeps unavailable saved entries visible for removal and permits at most five choices", () => {
    fixture.bot.fallback = Array.from({ length: 5 }, (_, index) => ({ instanceId: `missing-${index}`, model: "old" }));
    expect(render().rows).toHaveLength(5);
    expect(render().all.some(node => node.type === Select)).toBe(false);
    click(render().find("Remove missing-0 · old from backups"));
    expect(render().rows).toHaveLength(4);
    expect(render().find("Backup provider")).toBeDefined();
  });

  it("keeps separate shared hosts distinct and preserves the exact source when reordering saved backups", async () => {
    const first = { instanceId: "origin-remote", model: "same-model", source: { hostId: "first-host", sourceId: "first-source" } };
    const second = { ...first, source: { hostId: "second-host", sourceId: "second-source" } };
    fixture.bot.fallback = [first, second];
    expect(fallbackKey(first)).not.toBe(fallbackKey(second));
    const down = render().all.find(node => typeof node.props["aria-label"] === "string" && (node.props["aria-label"] as string).startsWith("Move Shared account") && (node.props["aria-label"] as string).endsWith(" down"))!;
    click(down);
    fixture.api.mockResolvedValueOnce({ bot: { ...fixture.bot, fallback: [second, first] } });
    click(render().button("Save")); await flush();
    expect(JSON.parse(fixture.api.mock.calls[0][1].body)).toEqual({ fallback: [second, first] });
  });

  it("writes only edited fields even when another window changes untouched settings after editing starts", async () => {
    fixture.bot.fallback = [pair("second"), pair("third")];
    click(render().find("Move Local account · Second down"));
    fixture.bot = { ...fixture.bot, quotaFallback: true, fallbackApiAllowed: true, dailyApiBudgetUsd: 9 };
    fixture.api.mockResolvedValueOnce({ bot: { ...fixture.bot, fallback: [pair("third"), pair("second")] } });
    click(render().button("Save")); await flush();
    expect(JSON.parse(fixture.api.mock.calls[0][1].body)).toEqual({ fallback: [pair("third"), pair("second")] });
    expect(fixture.bot).toMatchObject({ quotaFallback: true, fallbackApiAllowed: true, dailyApiBudgetUsd: 9 });
  });

  it("keeps the dragged model identity when the saved order changes before drop", () => {
    fixture.bot.fallback = [pair("second"), pair("third"), pair("fourth")];
    const gesture = pointerGesture("Second"); gesture.down();
    fixture.bot = { ...fixture.bot, fallback: [pair("third"), pair("second"), pair("fourth")] };
    gesture.pointAt(fallbackKey(pair("fourth"))); gesture.move(10, 100); gesture.up(10, 100);
    expect(savedNames()).toEqual(["Local account · Third", "Local account · fourth", "Local account · Second"]);
  });

  it("ignores clicks, cancelled pointers and releases outside its own ranked list", () => {
    fixture.bot.fallback = [pair("second"), pair("third")];
    const clickOnly = pointerGesture("Second"); clickOnly.down(); clickOnly.pointAt(fallbackKey(pair("third"))); clickOnly.move(11, 11); clickOnly.up(11, 11);
    expect(render().button("Save").props.disabled).toBe(true);
    const cancelled = pointerGesture("Second"); cancelled.down(); cancelled.pointAt(fallbackKey(pair("third"))); cancelled.move(10, 50); cancelled.cancel(); cancelled.up(10, 50);
    expect(render().button("Save").props.disabled).toBe(true);
    const outside = pointerGesture("Second"); outside.down(); outside.pointAt(fallbackKey(pair("third"))); outside.move(10, 50); outside.up(301, 50);
    expect(savedNames()).toEqual(["Local account · Second", "Local account · Third"]);
    expect(render().button("Save").props.disabled).toBe(true);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("ignores another pointer, unrelated ranked lists and a lost pointer capture", () => {
    fixture.bot.fallback = [pair("second"), pair("third")];
    const gesture = pointerGesture("Second"); gesture.down(); gesture.pointAt(fallbackKey(pair("third"))); gesture.move(10, 50); gesture.otherUp();
    expect(render().button("Save").props.disabled).toBe(true);
    gesture.pointAt(fallbackKey(pair("third")), false); gesture.up(10, 50);
    expect(render().button("Save").props.disabled).toBe(true);
    const lost = pointerGesture("Second"); lost.down(); lost.pointAt(fallbackKey(pair("third"))); lost.move(10, 50); lost.lostCapture(); lost.up(10, 50);
    expect(savedNames()).toEqual(["Local account · Second", "Local account · Third"]);
    expect(render().button("Save").props.disabled).toBe(true);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("cancels an in-progress gesture if editing permission is revoked", () => {
    fixture.bot.fallback = [pair("second"), pair("third")];
    const gesture = pointerGesture("Second"); gesture.down(); gesture.pointAt(fallbackKey(pair("third"))); gesture.move(10, 50);
    fixture.owner = false; gesture.up(10, 50);
    expect(gesture.handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(savedNames()).toEqual(["Local account · Second", "Local account · Third"]);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("aborts an unmounted editor save and ignores a response even when the transport resolves after cancellation", async () => {
    click(render().switches[0]);
    let resolve!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const cleanup = fixture.effects[0]();
    click(render().button("Save"));
    const signal = fixture.api.mock.calls[0][1].signal as AbortSignal;
    cleanup(); expect(signal.aborted).toBe(true);
    resolve({ bot: { ...fixture.bot, quotaFallback: true } }); await flush();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("does not offer settings writes to a non-owner", () => {
    fixture.owner = false;
    expect(render().html).toContain("Only this server");
    expect(render().switches.every(node => node.props.disabled === true)).toBe(true);
    expect(render().button("Save").props.disabled).toBe(true);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("uses exact pair identities, stable moves and the effective API billing route", () => {
    expect(fallbackKey(pair("second"))).not.toBe(fallbackKey(pair("third")));
    const original = [pair("second"), pair("third")];
    expect(moveFallback(original, 0, 1)).toEqual([pair("third"), pair("second")]);
    expect(original).toEqual([pair("second"), pair("third")]);
    expect(moveFallback(original, 0, 20)).toEqual(original);
    expect(paidApiInstance({ ...fixture.instances[0], snapshot: { state: "available", billing: "metered" } })).toBe(true);
    expect(paidApiInstance(fixture.instances[0])).toBe(false);
  });
});
