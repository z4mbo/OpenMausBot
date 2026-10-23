import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudProject } from "@/lib/origin-cloud";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, owner: true, effects: [] as Array<() => void | (() => void)>, api: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => { const index = fixture.index++; if (!(index in fixture.values)) fixture.values[index] = initial; return [fixture.values[index], (next: unknown) => { fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next; }]; }, useRef: (initial: unknown) => { const index = fixture.index++; return fixture.values[index] ??= { current: initial }; }, useEffect: (effect: () => void | (() => void)) => { fixture.effects.push(effect); } }));
vi.mock("@/state/store", () => ({ api: fixture.api }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.owner }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: (name: string) => name === "workspaces:list" ? [{ _id: "team", name: "Origin" }] : [{ _id: "project", teamId: "team", name: "Website" }] }));
import { ModelHostingSettings, validateHostingDraft, type HostingSourceSettings, type ModelHostingReport } from "./ModelHostingSettings";

const source = (patch: Partial<HostingSourceSettings> = {}): HostingSourceSettings => ({ sourceKey: "existing-key", instanceId: "claude", provider: "claudeAgent", label: "Claude", billing: "subscription", models: ["sonnet"], enabled: true, projectIds: ["project"], workspaceHead: false, capacity: 1, ...patch });
const report = (patch: Partial<ModelHostingReport> = {}): ModelHostingReport => ({ ready: true, computerName: "Alice’s Mac", teams: ["team"], hosts: [{ teamId: "team", hostId: "host", sources: [source()] }], instances: [{ instanceId: "claude", provider: "claudeAgent", displayName: "Claude", billing: "subscription", available: true, models: ["sonnet"] }], ...patch });
type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap(child => isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []);
function render() { let tree: ReactNode = null; function Capture() { fixture.index = 0; tree = ModelHostingSettings(); return tree; } const html = renderToStaticMarkup(createElement(Capture)); const all = nodes(tree); return { html, all, button: (label: string) => all.find(node => node.type === "button" && node.props.children === label)! }; }
const click = (node: Node) => (node.props.onClick as () => void)();
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => { fixture.values = []; fixture.index = 0; fixture.effects = []; fixture.owner = true; fixture.api.mockReset(); });

describe("owner-controlled account sharing", () => {
  it("loads settings without enabling or publishing any source and denies guest edits", async () => {
    fixture.api.mockResolvedValue(report()); render(); const cleanup = fixture.effects[0](); await flush();
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/origin/model-host", { signal: expect.any(AbortSignal) });
    expect(render().html).toContain("Alice’s Mac");
    cleanup?.(); fixture.owner = false;
    expect(render().html).toContain("Only this server’s owner");
    expect(render().html).not.toContain("Alice’s Mac");
  });

  it("keeps edits after a failed single-flight save and aborts late results when the settings close", async () => {
    fixture.values = [report(), "team", source(), false, "", false, false];
    fixture.api.mockResolvedValueOnce(report());
    render(); const cleanup = fixture.effects[0](); await flush(); fixture.api.mockClear();
    let reject!: (error: Error) => void;
    fixture.api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    click(render().button("Save")); click(render().button("Saving…"));
    expect(fixture.api).toHaveBeenCalledOnce();
    reject(new Error("Fixture save failed")); await flush();
    expect(render().html).toContain("Fixture save failed"); expect(render().button("Save")).toBeDefined();
    let resolve!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    click(render().button("Save")); const signal = fixture.api.mock.calls[1][1].signal as AbortSignal;
    cleanup?.(); expect(signal.aborted).toBe(true); resolve({ source: source() }); await flush();
    expect(fixture.api).toHaveBeenCalledTimes(2);
  });

  it("requires exact available model and explicit scope but lets an owner disable an existing offline source", () => {
    const projects: CloudProject[] = [{ _id: "project", teamId: "team", name: "Website" }];
    expect(validateHostingDraft(source(), report(), projects)).toBe(true);
    expect(validateHostingDraft(source({ models: ["invented"] }), report(), projects)).toBe(false);
    expect(validateHostingDraft(source({ projectIds: [], workspaceHead: false }), report(), projects)).toBe(false);
    expect(validateHostingDraft(source({ projectIds: ["foreign"] }), report(), projects)).toBe(false);
    expect(validateHostingDraft(source({ sourceKey: "new-key", enabled: false, models: [] }), report(), projects)).toBe(false);
    expect(validateHostingDraft(source({ enabled: false }), report({ instances: [] }), undefined)).toBe(true);
    expect(validateHostingDraft(source(), report({ ready: false }), projects)).toBe(false);
  });

  it("keeps unfinished hosting unavailable without granting or exposing account controls", () => {
    fixture.values = [report({ ready: false, reason: "Teammate-hosted models are unavailable in this release." }), "team", source(), false, "", false, false];
    const view = render(); expect(view.html).toContain("unavailable in this release");
    expect(view.html).not.toContain('aria-label="Account on this computer"'); expect(view.html).not.toContain("Enable sharing");
    expect(fixture.api).not.toHaveBeenCalled();
  });
});
