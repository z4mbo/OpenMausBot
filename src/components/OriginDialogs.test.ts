// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OriginConnectDialog } from "./OriginConnect";
import { WorkspaceSwitcher } from "./SidebarProjects";
import { AssignIssueDialog } from "./origin-pages/AssignIssueDialog";
import type { Bot } from "@/state/store";

vi.mock("./Avatar", () => ({ BotAvatar: () => createElement("span", null, "Avatar") }));
vi.mock("./origin-members", () => ({ WorkspaceMembersPanel: () => createElement("button", null, "Manage members"), RuntimeHelp: () => null }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => ({ workspaces: {}, projects: {} }) }));
vi.mock("@/lib/origin-cloud", () => ({ cloudUrl: () => null, setCloudUrl: vi.fn(), useCloudQuery: () => undefined, useCloudSession: () => ({ user: null, login: vi.fn(), logout: vi.fn() }) }));

let host: HTMLDivElement;
let opener: HTMLButtonElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  opener = document.createElement("button");
  document.body.append(opener, host);
  opener.focus();
  root = createRoot(host);
  document.documentElement.dataset.reducedMotion = "true";
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  opener.remove();
  delete document.documentElement.dataset.reducedMotion;
});

const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

describe("Origin dialog keyboard access", () => {
  it("contains assignment focus and preserves choosing an agent", () => {
    const picked = vi.fn();
    const closed = vi.fn();
    const agent = { id: "developer", name: "Developer" } as Bot;
    flushSync(() => root.render(createElement(AssignIssueDialog, {
      issue: { id: "task", key: "ORI-1", projectId: "project", projectName: "Project", title: "Example", priority: "medium", labels: [], status: "Draft" },
      agents: [agent], onPick: picked, onClose: closed,
    })));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement?.textContent).toContain("Developer");
    flushSync(() => (document.activeElement as HTMLButtonElement).click());
    expect(picked).toHaveBeenCalledExactlyOnceWith(agent);
    escape();
    expect(closed).toHaveBeenCalledOnce();
    flushSync(() => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it("allows account dismissal with Escape and returns to its opener", () => {
    const closed = vi.fn();
    flushSync(() => root.render(createElement(OriginConnectDialog, { onClose: closed })));
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
    escape();
    expect(closed).toHaveBeenCalledOnce();
    flushSync(() => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it("contains the members panel and dismisses it with Escape", () => {
    flushSync(() => root.render(createElement(WorkspaceSwitcher, { heads: [], onNewWorkspace: vi.fn() })));
    const switcher = host.querySelector<HTMLButtonElement>("button")!;
    switcher.focus();
    flushSync(() => switcher.click());
    const members = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Members & invites"))!;
    flushSync(() => members.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    flushSync(escape);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(switcher);
  });
});
