// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { chooseProjectAgent, projectAgentSelection, visibleProjectAgentThread } from "@/lib/origin-agent-navigation";
import { openNotificationTarget } from "@/state/thread-navigation";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: fixture.dispatch }) }));
vi.mock("@/lib/thread-transcript", () => ({ useThreadTranscript: () => [] }));
vi.mock("./lazy-screens", () => ({ NewBotDialog: () => null }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
vi.mock("./GlassScrollFrame", () => ({ GlassHeader: ({ children }: { children: unknown }) => children }));
vi.mock("./ChatView", () => ({ ChatView: ({ bot }: { bot: Bot }) => createElement("div", { "data-chat-thread": bot.threadId }, bot.messages.map(message => message.text).join(" ")) }));
import { ProjectAgentsPage } from "./ProjectAgentsPage";

const lead = { id: "agents-fixture-chief", name: "Origin", section: "Origin", chiefOfStaff: true, threadId: "project-a", tasks: [], messages: [] } as unknown as Bot;
const researcher = {
  id: "agents-fixture-researcher", name: "Researcher", title: "Researcher", section: "Origin", threadId: "direct-b", messages: [{ text: "Independent B" }],
  tasks: [
    { threadId: "child-a", title: "Project A research", createdAt: 1, busy: true, openedBy: { botId: lead.id, name: lead.name, threadId: "project-a", at: 1 } },
    { threadId: "direct-b", title: "Independent B", createdAt: 2 },
  ],
} as unknown as Bot;
let root: Root;
let host: HTMLDivElement;
const mount = (agent = researcher) => flushSync(() => root.render(createElement(ProjectAgentsPage, { lead, agents: [lead, agent] })));

beforeEach(() => {
  fixture.dispatch.mockReset();
  chooseProjectAgent(lead.id, researcher.id, "child-a", { chatOpen: false });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("project specialist conversations", () => {
  it("retries an awaiting specialist read on explicit row selection without selecting or switching the project", () => {
    mount({ ...researcher, threadId: "child-a", awaitingThreadSnapshot: true });
    fixture.dispatch.mockClear();
    flushSync(() => host.querySelector<HTMLButtonElement>('nav[aria-label="Origin agents"] button[aria-current="true"]')!.click());
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "retryPendingThreadSnapshot", botId: researcher.id, threadId: "child-a" });
    expect(projectAgentSelection(lead.id)?.threadId).toBe("child-a");
    expect(host.querySelector('[aria-label="Loading agent conversation"]')).not.toBeNull();
  });
  it("retries an awaiting specialist read on its current thread row", () => {
    mount({ ...researcher, threadId: "child-a", awaitingThreadSnapshot: true });
    fixture.dispatch.mockClear();
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-sidebar-thread-row="child-a"]')!.click());
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "retryPendingThreadSnapshot", botId: researcher.id, threadId: "child-a" });
    expect(projectAgentSelection(lead.id)?.threadId).toBe("child-a");
    expect(host.querySelector('[data-chat-thread]')).toBeNull();
  });
  it("does not retry a loaded specialist when its row is selected again", () => {
    mount({ ...researcher, threadId: "child-a" });
    fixture.dispatch.mockClear();
    flushSync(() => host.querySelector<HTMLButtonElement>('nav[aria-label="Origin agents"] button[aria-current="true"]')!.click());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-chat-thread="child-a"]')).not.toBeNull();
  });
  it("excludes the project boss and shows the specialist's delegated and direct threads", () => {
    mount();
    expect(host.querySelector('nav[aria-label="Origin agents"]')?.textContent).not.toContain("Lead");
    expect(host.querySelector('nav[aria-label="Origin agents"]')?.textContent).not.toContain("OriginIdle");
    expect(host.textContent).toContain("Project A research");
    expect(host.textContent).toContain("Independent B");
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "switchTask", botId: researcher.id, threadId: "child-a", preserveSelection: true }));
    expect(host.querySelector('[data-chat-thread]')).toBeNull();
    expect(host.querySelector('[aria-label="Loading agent conversation"]')).not.toBeNull();
  });
  it("renders A only after its transcript loads, then keeps an explicitly chosen direct B", () => {
    mount({ ...researcher, threadId: "child-a", messages: [{ text: "Project A history" }] } as Bot);
    expect(host.querySelector('[data-chat-thread="child-a"]')?.textContent).toBe("Project A history");
    const direct = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Independent B"))!;
    flushSync(() => direct.click());
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "switchTask", threadId: "direct-b", preserveSelection: true }));
    mount();
    expect(host.querySelector('[data-chat-thread="direct-b"]')?.textContent).toBe("Independent B");
  });
  it("creates a specialist thread without selecting the specialist outside the project page", () => {
    mount({ ...researcher, threadId: "child-a" });
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New thread")!.click());
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "newTask", botId: researcher.id, preserveSelection: true, onCreated: expect.any(Function) }));
  });
  it("returns from delegated work to its exact parent project conversation", () => {
    mount({ ...researcher, threadId: "child-a" });
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Project conversation")!.click());
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "switchTask", botId: lead.id, threadId: "project-a" });
  });
  it("shows a failed conversation load and waits for explicit retry", () => {
    mount();
    const action = fixture.dispatch.mock.calls.find(([action]) => action.type === "switchTask")![0];
    flushSync(() => action.onError("Conversation is unavailable"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Conversation is unavailable");
    expect(fixture.dispatch.mock.calls.filter(([action]) => action.type === "switchTask")).toHaveLength(1);
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Try again")!.click());
    expect(fixture.dispatch.mock.calls.filter(([action]) => action.type === "switchTask")).toHaveLength(2);
  });
  it("ignores a superseded load failure after returning to the same conversation", () => {
    mount();
    const first = fixture.dispatch.mock.calls.find(([action]) => action.type === "switchTask")![0];
    const select = (threadId: string) => flushSync(() => host.querySelector<HTMLButtonElement>(`[data-sidebar-thread-row="${threadId}"]`)!.click());
    select("direct-b");
    select("child-a");
    const latest = fixture.dispatch.mock.calls.filter(([action]) => action.type === "switchTask").at(-1)![0];
    expect(latest).not.toBe(first);
    flushSync(() => first.onError("Obsolete load failed"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    flushSync(() => latest.onError("Current load failed"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Current load failed");
  });
  it("does not retain a late load error after the conversation has loaded", () => {
    mount();
    const pending = fixture.dispatch.mock.calls.find(([action]) => action.type === "switchTask")![0];
    mount({ ...researcher, threadId: "child-a" });
    flushSync(() => pending.onError("Outdated transport failure"));
    mount();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[aria-label="Loading agent conversation"]')).not.toBeNull();
  });
  it("does not carry pending thread creation into another project", () => {
    mount({ ...researcher, threadId: "child-a" });
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New thread")!.click());
    const creation = fixture.dispatch.mock.calls.find(([action]) => action.type === "newTask")![0];
    const otherLead = { ...lead, id: "other-project", name: "Other project" };
    const otherAgent = { ...researcher, id: "other-researcher", threadId: "direct-b" };
    flushSync(() => root.render(createElement(ProjectAgentsPage, { lead: otherLead, agents: [otherAgent] })));
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New thread")?.disabled).toBe(false);
    flushSync(() => creation.onCreated("late-created-thread"));
    expect(projectAgentSelection(lead.id)?.threadId).toBe("child-a");
    expect(projectAgentSelection(otherLead.id)?.threadId).not.toBe("late-created-thread");
  });
  it("opens a revealed notification conversation on mobile and allows returning to the list", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const reveal = () => openNotificationTarget(fixture.dispatch, { botId: researcher.id, threadId: "direct-b" }, { bots: [lead, researcher], groups: [] }, true);
    reveal();
    mount();
    expect(host.querySelector('[data-chat-thread="direct-b"]')).not.toBeNull();
    expect(visibleProjectAgentThread(lead.id)).toBe("direct-b");
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Back to agents"]')!.click());
    expect(host.querySelector('[data-chat-thread]')).toBeNull();
    expect(visibleProjectAgentThread(lead.id)).toBeNull();
    flushSync(reveal);
    expect(host.querySelector('[data-chat-thread="direct-b"]')).not.toBeNull();
  });
});
