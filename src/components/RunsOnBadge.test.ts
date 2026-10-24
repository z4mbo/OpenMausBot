// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  runsOn: undefined as unknown,
  local: {} as Record<string, unknown>,
  user: { _id: "u1", email: "grace@example.test", name: "Grace", avatarUrl: null } as unknown,
}));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: () => fixture.runsOn, useCloudSession: () => ({ user: fixture.user }) }));
vi.mock("@/state/store", () => ({ api: async () => ({ instances: fixture.local }) }));
const { RunsOnBadge, SharedAgentRunsOn } = await import("./RunsOnBadge");
const { subscriptionLabel } = await import("@/lib/agent-subscription");

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => { if (root) flushSync(() => root!.unmount()); root = undefined; host?.remove(); });

function mount(element: ReturnType<typeof createElement>) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(element));
  return host.querySelector<HTMLElement>('[data-testid="runs-on-badge"]');
}

const bot = { id: "b", name: "Planner", threadId: "t", shared: { agentId: "a1", teamId: "team" }, modelSelection: { instanceId: "claude", model: "opus" }, tasks: [] } as unknown as Bot;
const hostRow = { name: "Ada's MacBook", kind: "local", ownerName: "Ada", ownerAvatarUrl: null, mine: false, online: true, plan: { provider: "claude", plan: "max" } };

describe("subscription labels", () => {
  it("names the product and plan the way people say them", () => {
    expect(subscriptionLabel({ provider: "claude", plan: "max" })).toBe("Claude Max");
    expect(subscriptionLabel({ provider: "claude", plan: "max_20x" })).toBe("Claude Max 20x");
    expect(subscriptionLabel({ provider: "chatgpt", plan: "plus" })).toBe("ChatGPT Plus");
    expect(subscriptionLabel({ provider: "grok", plan: "SuperGrok" })).toBe("SuperGrok");
    expect(subscriptionLabel({ provider: "grok" })).toBe("Grok");
    expect(subscriptionLabel({ provider: "key", plan: "OpenRouter" })).toBe("OpenRouter key");
    expect(subscriptionLabel({ provider: "key" })).toBe("API key");
    expect(subscriptionLabel(null)).toBeNull();
  });
});

describe("runs-on badge", () => {
  it("shows a member and their subscription, compactly", () => {
    const badge = mount(createElement(RunsOnBadge, { kind: "member", name: "Ada", subscription: "Claude Max" }));
    expect(badge?.textContent).toBe("ADAda · Claude Max");
    expect(badge?.getAttribute("aria-label")).toBe("Runs on Ada's computer, with Claude Max.");
    expect(badge?.querySelector('[data-testid="runs-on-offline"]')).toBeNull();
  });

  it("says Cloud for a server and marks an offline runner", () => {
    const badge = mount(createElement(RunsOnBadge, { kind: "cloud", name: "origin-vps", subscription: "Anthropic key", offline: true }));
    expect(badge?.textContent).toBe("Cloud");
    expect(badge?.getAttribute("aria-label")).toBe("Runs in the cloud on origin-vps. Uses Anthropic key. It is offline, so messages run on each sender's own computer for now.");
    expect(badge?.querySelector('[data-testid="runs-on-offline"]')).not.toBeNull();
  });

  it("follows the agent's setting for the person reading", async () => {
    fixture.runsOn = { mode: "member", host: hostRow };
    expect(mount(createElement(SharedAgentRunsOn, { bot }))?.textContent).toContain("Ada · Claude Max");
    flushSync(() => root!.unmount()); root = undefined; host.remove();

    fixture.runsOn = { mode: "cloud", host: { ...hostRow, kind: "server", name: "origin-vps", online: false } };
    expect(mount(createElement(SharedAgentRunsOn, { bot }))?.dataset.runsOnKind).toBe("cloud");
    flushSync(() => root!.unmount()); root = undefined; host.remove();

    fixture.runsOn = { mode: "sender", host: null };
    fixture.local = { claude: { provider: "claude", plan: "pro" } };
    mount(createElement(SharedAgentRunsOn, { bot }));
    await vi.waitFor(() => expect(host.textContent).toContain("You · Claude Pro"));
  });

  it("stays out of chats with agents that are not shared", () => {
    fixture.runsOn = { mode: "sender", host: null };
    expect(mount(createElement(SharedAgentRunsOn, { bot: { ...bot, shared: undefined } as Bot }))).toBeNull();
  });
});
