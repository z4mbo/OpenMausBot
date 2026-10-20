import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, ModelSelection } from "@/state/store";
import type { ModelHostSource } from "@/lib/origin-model-hosts";

const fixture = vi.hoisted(() => ({ ready: true, confirmation: { current: false }, effects: [] as Array<() => unknown>, values: [] as unknown[], index: 0, sources: [] as ModelHostSource[], bot: null as unknown as Bot, instances: [] as InstanceInfo[], dispatch: vi.fn(), reload: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (effect: () => unknown) => fixture.effects.push(effect), useState: (initial: unknown) => { const index = fixture.index++; if (!(index in fixture.values)) fixture.values[index] = initial; return [fixture.values[index], (next: unknown) => { fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next; }]; } }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: [fixture.bot], instances: fixture.instances }, dispatch: fixture.dispatch }), currentTaskBot: (bot: Bot) => bot }));
vi.mock("@/lib/origin-model-hosts", async original => ({ ...await original<typeof import("@/lib/origin-model-hosts")>(), useModelHostCatalog: () => ({ ready: fixture.ready, sources: fixture.sources, loading: false, error: "", reload: fixture.reload }) }));
vi.mock("./ConfirmDialog", () => ({ ConfirmDialog: ({ open, body }: { open: boolean; body: string }) => open ? createElement("p", null, body) : null }));
import { ConfirmDialog } from "./ConfirmDialog";
import { SharedModelChoices } from "./SharedModelChoices";
import { RemoteModelPicker } from "./RemoteModelPicker";

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap(child => isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []);
const chosen = vi.fn();
function render() { let tree: ReactNode = null; function Capture() { fixture.index = 0; tree = RemoteModelPicker({ bot: fixture.bot, threadId: "thread", updateBotDefault: false, onChosen: chosen, confirmationRef: fixture.confirmation }); return tree; } const html = renderToStaticMarkup(createElement(Capture)); const all = nodes(tree); return { html, choices: all.find(node => node.type === SharedModelChoices)!, confirm: all.find(node => node.type === ConfirmDialog)! }; }
const select = (selection: ModelSelection, source = fixture.sources[0]) => (render().choices.props.onChoose as (selection: ModelSelection, source: ModelHostSource) => void)(selection, source);
const confirm = () => (render().confirm.props.onConfirm as () => void)();
beforeEach(() => {
  fixture.ready = true; fixture.confirmation.current = false; fixture.effects = []; fixture.values = []; fixture.index = 0; fixture.dispatch.mockReset(); fixture.reload.mockReset(); chosen.mockReset();
  fixture.sources = [{ sourceId: "source", hostId: "host", ownerUserId: "alice", ownerName: "Alice", computerName: "Mac", label: "Claude API", provider: "claudeAgent", billing: "metered", models: ["sonnet"], heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000, capacity: 1 }];
  fixture.bot = { id: "atlas", threadId: "thread", name: "Atlas", title: "", description: "", color: "green", notifications: false, unread: false, messages: [], modelSelection: { instanceId: "local", model: "primary", effort: "high", variant: "local-variant" }, shared: { agentId: "agent", teamId: "team", canEdit: false } };
  fixture.instances = [{ instanceId: "local", driverKind: "codex", displayName: "Codex", snapshot: { state: "available" }, models: { default: "primary", options: [] } }];
});

describe("explicit remote model selection", () => {
  it("requires a named owner/computer and paid-account confirmation before changing the selected thread", () => {
    const selection: ModelSelection = { instanceId: "origin-remote", model: "sonnet", source: { hostId: "host", sourceId: "source" } };
    select(selection);
    expect(fixture.dispatch).not.toHaveBeenCalled();
    const view = render(); expect(view.html).toContain("Alice · Mac · Claude API"); expect(view.html).toContain("owner pays API charges");
    confirm();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "setModel", botId: "atlas", threadId: "thread", updateBotDefault: false, selection });
    expect(chosen).toHaveBeenCalledOnce();
  });

  it("refuses a source removed or expired while confirmation is open", () => {
    select({ instanceId: "origin-remote", model: "sonnet", source: { hostId: "host", sourceId: "source" } });
    fixture.sources = []; confirm();
    expect(fixture.dispatch).not.toHaveBeenCalled(); expect(chosen).not.toHaveBeenCalled(); expect(fixture.reload).toHaveBeenCalledOnce();
    expect(render().html).toContain("no longer available");
  });

  it("does not offer global defaults or new unbound bots a shared account", () => {
    fixture.bot = { ...fixture.bot, shared: undefined };
    expect(render().html).toBe(""); expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("requires the server's explicit readiness before exposing unfinished shared accounts", () => {
    fixture.ready = false; expect(render().html).toBe(""); expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("releases the parent menu dismissal guard when the source service becomes unavailable during confirmation", () => {
    select({ instanceId: "origin-remote", model: "sonnet", source: { hostId: "host", sourceId: "source" } });
    expect(fixture.confirmation.current).toBe(true);
    fixture.ready = false; render(); fixture.effects.at(-1)!();
    expect(fixture.confirmation.current).toBe(false); expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("confirms the permission reset when switching a provider-specific approval policy", () => {
    fixture.bot = { ...fixture.bot, approvalMode: "custom" };
    select({ instanceId: "origin-remote", model: "sonnet", source: { hostId: "host", sourceId: "source" } }); confirm();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ resetApprovalToAsk: true }));
  });
});
