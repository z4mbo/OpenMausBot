// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ failed: true, authorityFailed: false, pending: false, subscriptions: 0, url: "http://127.0.0.1:34321", token: "synthetic-private-session", watchers: new Map<string, Set<() => void>>() }));
vi.mock("./client", () => ({
  urlStore: { subscribe: () => () => {}, get: () => fixture.url },
  sessionStore: { subscribe: () => () => {}, get: () => fixture.token },
  functionRef: (name: string) => name, withSession: (args: unknown) => args,
  setSessionToken: vi.fn(), logoutCloud: vi.fn(),
  cloudClient: () => ({
    query: async () => ({ _id: "fixture-user", email: "user@example.test" }),
    watchQuery: (name: string) => ({
      localQueryResult: () => {
        if (name === "auth:me") return { _id: "fixture-user", email: "user@example.test" };
        if (name === "projects:get") { if (fixture.authorityFailed) throw new Error("Project access was revoked"); return { _id: "fixture-project", name: "Fixture", memberRole: "owner" }; }
        if (fixture.pending) return undefined;
        if (fixture.failed) throw new Error("Access denied: synthetic-private-session and synthetic-private-secret");
        return name === "fixture:pages" ? { page: ["ready"], isDone: true, continueCursor: "" } : "ready";
      },
      onUpdate: (listener: () => void) => {
        fixture.subscriptions++;
        const watchers = fixture.watchers.get(name) ?? new Set<() => void>();
        watchers.add(listener);
        fixture.watchers.set(name, watchers);
        return () => { watchers.delete(listener); };
      },
    }),
  }),
}));
const { useCloudQuery, useCloudPages } = await import("./hooks");
const { CloudGate } = await import("../../components/origin-pages/ui");
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { flushSync(() => root.unmount()); host.replaceChildren(); root = createRoot(host); fixture.failed = true; fixture.authorityFailed = false; fixture.pending = false; fixture.subscriptions = 0; fixture.url = "http://127.0.0.1:34321"; fixture.token = "synthetic-private-session"; fixture.watchers.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });
function Query({ paginated = false }: { paginated?: boolean }) {
  const value = useCloudQuery<string>("fixture:query", paginated ? "skip" : {});
  const pages = useCloudPages<string>("fixture:pages", paginated ? {} : "skip", 5);
  return createElement("p", null, paginated ? pages.results.join(",") || "loading" : value ?? "loading");
}
const render = (paginated = false, projectId = "fixture-project") => flushSync(() => root.render(createElement(CloudGate, { cloudProjectId: projectId, projectName: "Fixture", label: "Assets", children: () => createElement(Query, { paginated }) })));
const notify = (name: string) => flushSync(() => { for (const listener of fixture.watchers.get(name) ?? []) listener(); });
function Editor({ paginated }: { paginated: boolean }) {
  const [draft, setDraft] = useState("");
  return createElement("div", null, createElement(Query, { paginated }), createElement("input", { "aria-label": "Draft", value: draft, onChange: (event) => setDraft(event.target.value) }));
}
describe("scoped Origin query failures", () => {
  it.each([false, true])("shows a safe retry for a rejected query (paginated=%s)", async (paginated) => {
    render(paginated);
    await vi.waitFor(() => expect(host.textContent).toContain("Could not load assets"), { timeout: 250 });
    expect(host.textContent).not.toContain("synthetic-private");
    const before = fixture.subscriptions;
    fixture.failed = false;
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Try again")!.click());
    await vi.waitFor(() => expect(host.textContent).toBe("ready"), { timeout: 250 });
    expect(fixture.subscriptions).toBeGreaterThan(before);
  });
  it.each([false, true])("offers a retry for an unresolved transport (paginated=%s)", async (paginated) => {
    vi.useFakeTimers();
    fixture.pending = true;
    render(paginated);
    await Promise.resolve();
    render(paginated);
    render(paginated);
    render(paginated);
    expect(host.textContent).toBe("loading");
    flushSync(() => { vi.advanceTimersByTime(12_001); });
    expect(host.textContent).toContain("Could not load assets");
  });
  it("preserves the existing undefined result outside the opt-in scope", () => {
    flushSync(() => root.render(createElement(Query)));
    flushSync(() => {});
    expect(host.textContent).toBe("loading");
  });
  it.each(["project", "account", "server"])("does not retain another %s's failure card", async (kind) => {
    render();
    await vi.waitFor(() => expect(host.textContent).toContain("Could not load assets"), { timeout: 250 });
    fixture.failed = false;
    if (kind === "account") fixture.token = "synthetic-new-session";
    if (kind === "server") fixture.url = "http://127.0.0.1:34322";
    render(false, kind === "project" ? "fixture-other-project" : "fixture-project");
    await vi.waitFor(() => expect(host.textContent).toBe("ready"), { timeout: 250 });
  });
  it.each([false, true])("keeps loaded data and an unsaved editor through refresh failure/retry (paginated=%s)", async (paginated) => {
    fixture.failed = false;
    flushSync(() => root.render(createElement(CloudGate, { cloudProjectId: "fixture-project", projectName: "Fixture", label: "Assets", children: () => createElement(Editor, { paginated }) })));
    await vi.waitFor(() => expect(host.textContent).toContain("ready"), { timeout: 250 });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
    flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Unsaved local draft"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    fixture.failed = true;
    notify(paginated ? "fixture:pages" : "fixture:query");
    await vi.waitFor(() => expect(host.textContent).toContain("Could not refresh assets"), { timeout: 250 });
    expect(host.textContent).toContain("ready");
    expect(host.querySelector('input[aria-label="Draft"]')).toBe(input);
    expect(input.value).toBe("Unsaved local draft");
    fixture.failed = false;
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Try again")!.click());
    await vi.waitFor(() => expect(host.textContent).not.toContain("Could not refresh assets"), { timeout: 250 });
    expect(host.querySelector('input[aria-label="Draft"]')).toBe(input);
    expect(input.value).toBe("Unsaved local draft");
  });
  it("fails closed when the loaded project's authoritative access query is revoked", async () => {
    fixture.failed = false;
    render();
    await vi.waitFor(() => expect(host.textContent).toBe("ready"), { timeout: 250 });
    fixture.authorityFailed = true;
    notify("projects:get");
    await vi.waitFor(() => expect(host.textContent).toContain("Could not load assets"), { timeout: 250 });
    expect(host.textContent).not.toContain("ready");
  });
  it("keeps the old refresh-failure behavior outside the scope", async () => {
    fixture.failed = false;
    flushSync(() => root.render(createElement(Query)));
    await vi.waitFor(() => expect(host.textContent).toBe("ready"), { timeout: 250 });
    fixture.failed = true;
    notify("fixture:query");
    expect(host.textContent).toBe("loading");
  });
});
