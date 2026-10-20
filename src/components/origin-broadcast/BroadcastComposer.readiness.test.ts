import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BroadcastChannel } from "../../../shared/broadcast";
import type { BroadcastPost } from "./broadcast-model";

vi.mock("@/lib/origin-cloud", () => ({
  useCloudQuery: () => ({ assets: [] }),
  cloudMutation: vi.fn(),
}));
vi.mock("@/state/store", () => ({ api: vi.fn() }));
vi.mock("../origin-pages/ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("../origin-pages/ui")>(),
  Modal: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

const { BroadcastComposer } = await import("./BroadcastComposer");
const post = (patch: Partial<BroadcastPost> = {}): BroadcastPost => ({
  _id: "post", projectId: "project", variants: [{ channel: "x", text: "Synthetic preview draft." }], assetIds: [],
  status: "draft", createdAt: 0, updatedAt: 0, media: [], needsApproval: false, ...patch,
});

function render(connected: Partial<Record<BroadcastChannel, boolean>> | null, patch: Partial<BroadcastPost> = {}): string {
  return renderToStaticMarkup(createElement(BroadcastComposer, {
    projectId: "project", post: post(patch), canEdit: true, connected, onConnect() {}, onClose() {},
  }));
}

function disabled(markup: string, label: string): boolean {
  const button = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((item) => item.replace(/<[^>]*>/g, "").trim() === label);
  expect(button, `${label} button`).toBeDefined();
  return /\bdisabled(?:=|\s|>)/.test(button!);
}

describe("Broadcast publishing connections", () => {
  it("keeps publishing unavailable for a disconnected channel while allowing draft saves", () => {
    const markup = render({ x: false });
    expect(markup).toContain("not connected on this computer");
    expect(disabled(markup, "Publish now")).toBe(true);
    expect(disabled(markup, "Save draft")).toBe(false);
  });

  it.each([null, {}])("requires confirmed channel readiness instead of treating %j as connected", (connected) => {
    expect(disabled(render(connected), "Publish now")).toBe(true);
  });

  it("requires every pending channel before scheduling", () => {
    const markup = render({ x: true, bluesky: false }, {
      variants: [{ channel: "x", text: "Synthetic draft" }, { channel: "bluesky", text: "Synthetic draft" }],
      scheduledAt: Date.now() + 3_600_000,
    });
    expect(disabled(markup, "Schedule")).toBe(true);
    expect(disabled(markup, "Save draft")).toBe(false);
  });

  it("permits publishing with confirmed connections", () => {
    expect(disabled(render({ x: true }), "Publish now")).toBe(false);
  });

  it("does not require reconnecting a channel whose variant already published", () => {
    const markup = render({ x: false, bluesky: true }, { status: "failed", variants: [
      { channel: "x", text: "Already sent", result: "published", publishedAt: 1 },
      { channel: "bluesky", text: "Ready to retry" },
    ] });
    expect(disabled(markup, "Publish now")).toBe(false);
  });

  it("preserves approval of a draft even when the channel is disconnected", () => {
    const markup = render({ x: false }, { needsApproval: true, agentName: "Copywriter" });
    expect(disabled(markup, "Approve")).toBe(false);
    expect(disabled(markup, "Save draft")).toBe(false);
  });
});
