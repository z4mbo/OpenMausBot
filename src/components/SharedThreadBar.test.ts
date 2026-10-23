import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn(), useStore: () => ({ state: { bots: [], instances: [] }, dispatch: vi.fn() }) }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => ({ workspaces: {}, projects: {} }), useCloudProjectFor: () => undefined, useCloudWorkspaceFor: () => undefined }));
vi.mock("@/lib/origin-cloud/hooks", () => ({ useCloudQuery: () => undefined }));

const { RemoteCard, RemoteRowNote, SharedThreadBar } = await import("./SharedThreadBar");
import type { Bot, Message } from "@/state/store";

const remote = { cloudId: "c1", name: "Ada", model: "claude-haiku-5-5", status: "final" as const };

describe("shared thread rows", () => {
  it("credits another member's reply to their machine and model, and their message to them", () => {
    expect(renderToStaticMarkup(createElement(RemoteRowNote, { message: { id: "1", role: "bot", kind: "text", text: "hi", at: 1, remote } as Message }))).toContain("Ran on Ada&#x27;s claude-haiku-5-5");
    expect(renderToStaticMarkup(createElement(RemoteRowNote, { message: { id: "2", role: "user", kind: "text", text: "hi", at: 1, remote } as Message }))).toContain("Ada");
    expect(renderToStaticMarkup(createElement(RemoteRowNote, { message: { id: "3", role: "bot", kind: "text", text: "hi", at: 1 } as Message }))).toBe("");
  });

  it("shows another member's approval as waiting on them, with nothing to press", () => {
    const html = renderToStaticMarkup(createElement(RemoteCard, {
      message: { id: "4", role: "bot", kind: "options", at: 1, remote, card: { title: "Run rm?", subtitle: "Bash", options: ["Allow", "Deny"], requestId: "remote:c1" } } as Message,
    }));
    expect(html).toContain("Waiting for Ada&#x27;s approval");
    expect(html).not.toContain("<button");
  });

  it("tells the composer who holds the thread without promising an executor for queued work", () => {
    const bot = {
      id: "b", threadId: "t", name: "Dev", modelSelection: { instanceId: "claude", model: "m" }, shared: { agentId: "a", teamId: "team", canEdit: false },
      tasks: [{ threadId: "t", title: "T", createdAt: 1, shared: { cloudThreadId: "ct", run: { by: "Ada", mine: false } } }],
    } as unknown as Bot;
    const html = renderToStaticMarkup(createElement(SharedThreadBar, { bot, empty: false }));
    expect(html).toContain("Working for Ada.");
    expect(html).not.toContain("on your models");
    expect(html).toContain("Shared with your team");
    const noModel = renderToStaticMarkup(createElement(SharedThreadBar, { bot: { ...bot, modelSelection: { instanceId: "", model: "" } } as Bot, empty: true }));
    expect(noModel).toContain("Set up a model to talk to shared bots");
  });

  it("shows the actual remote executor even when this person requested the turn", () => {
    const bot = {
      id: "b", threadId: "t", name: "Dev", modelSelection: { instanceId: "origin-remote", model: "m" }, shared: { agentId: "a", teamId: "team", canEdit: false },
      tasks: [{ threadId: "t", title: "T", createdAt: 1, shared: { cloudThreadId: "ct", run: { by: "Requester", mine: true, executedByName: "Ada", hostId: "host-a", sourceId: "source-a" } } }],
    } as unknown as Bot;
    const html = renderToStaticMarkup(createElement(SharedThreadBar, { bot, empty: false }));
    expect(html).toContain("Running on Ada&#x27;s computer");
    expect(html).not.toContain("Running on Requester");
  });

  it("does not attribute an unclaimed shared host to the requester", () => {
    const bot = {
      id: "b", threadId: "t", name: "Dev", modelSelection: { instanceId: "origin-remote", model: "m" }, shared: { agentId: "a", teamId: "team", canEdit: false },
      tasks: [{ threadId: "t", title: "T", createdAt: 1, shared: { cloudThreadId: "ct", run: { by: "Requester", mine: true, hostId: "host-a", sourceId: "source-a" } } }],
    } as unknown as Bot;
    const html = renderToStaticMarkup(createElement(SharedThreadBar, { bot, empty: false }));
    expect(html).toContain("Waiting for shared computer");
    expect(html).not.toContain("Running on Requester");
  });
});
