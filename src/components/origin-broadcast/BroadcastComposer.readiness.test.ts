// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BroadcastAccount, BroadcastChannel } from "../../../shared/broadcast";
import type { BroadcastPost } from "./broadcast-model";
import { accountsByChannel, type ChannelAccounts } from "./use-broadcast-accounts";

const cloud = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudQuery: () => ({ assets: [] }),
  cloudMutation: cloud.mutation,
}));
vi.mock("@/state/store", () => ({ api: vi.fn(async () => ({})) }));
vi.mock("../origin-pages/ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("../origin-pages/ui")>(),
  Modal: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

const { BroadcastComposer } = await import("./BroadcastComposer");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const post = (patch: Partial<BroadcastPost> = {}): BroadcastPost => ({
  _id: "post", projectId: "project", variants: [{ channel: "x", text: "Synthetic preview draft." }], assetIds: [],
  status: "draft", createdAt: 0, updatedAt: 0, media: [], needsApproval: false, ...patch,
});

const account = (channel: BroadcastChannel, patch: Partial<BroadcastAccount> = {}): BroadcastAccount => ({
  id: channel, integration: channel === "instagram" || channel === "facebook" ? "meta" : channel,
  channels: [channel], label: `@${channel}-fixture`, isDefault: true, projectIds: null, source: "yours", ...patch,
});
const connected = (...channels: BroadcastChannel[]) => accountsByChannel(channels.map((channel) => account(channel)));

function render(accounts: ChannelAccounts | null, patch: Partial<BroadcastPost> = {}): string {
  return renderToStaticMarkup(createElement(BroadcastComposer, {
    projectId: "project", projectName: "Fixture", post: post(patch), posts: [], canEdit: true, accounts, onConnect() {}, onClose() {},
  }));
}

function disabled(markup: string, label: string): boolean {
  const button = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((item) => item.replace(/<[^>]*>/g, "").trim() === label);
  expect(button, `${label} button`).toBeDefined();
  return /\bdisabled(?:=|\s|>)/.test(button!);
}

describe("Broadcast publishing connections", () => {
  it("keeps publishing unavailable for a disconnected channel while allowing draft saves", () => {
    const markup = render(connected());
    expect(markup).toContain("not connected on this computer");
    expect(disabled(markup, "Publish now")).toBe(true);
    expect(disabled(markup, "Save draft")).toBe(false);
  });

  it("requires confirmed accounts while the local account list is unknown", () => {
    const markup = render(null);
    expect(markup).toContain("Connections are not confirmed on this computer");
    expect(disabled(markup, "Publish now")).toBe(true);
    expect(disabled(markup, "Save draft")).toBe(false);
  });

  it("requires every pending channel before scheduling", () => {
    const markup = render(connected("x"), {
      variants: [{ channel: "x", text: "Synthetic draft" }, { channel: "bluesky", text: "Synthetic draft" }],
      scheduledAt: Date.now() + 3_600_000,
    });
    expect(disabled(markup, "Schedule")).toBe(true);
    expect(disabled(markup, "Save draft")).toBe(false);
  });

  it("permits publishing with confirmed connections", () => {
    expect(disabled(render(connected("x")), "Publish now")).toBe(false);
  });

  it("does not require reconnecting a channel whose variant already published", () => {
    const markup = render(connected("bluesky"), { status: "failed", variants: [
      { channel: "x", text: "Already sent", result: "published", publishedAt: 1 },
      { channel: "bluesky", text: "Ready to retry" },
    ] });
    expect(disabled(markup, "Publish now")).toBe(false);
  });

  it("preserves approval of a draft even when the channel is disconnected", () => {
    const markup = render(connected(), { needsApproval: true, agentName: "Copywriter" });
    expect(disabled(markup, "Approve")).toBe(false);
    expect(disabled(markup, "Save draft")).toBe(false);
  });

  it("keeps the selected extra account identity unavailable instead of silently publishing as another account", () => {
    const markup = render(connected("x"), { variants: [{ channel: "x", text: "Saved draft", accountId: "removed-extra", accountLabel: "Founder" }] });
    expect(markup).toContain("selected account is no longer available");
    expect(disabled(markup, "Publish now")).toBe(true);
    expect(disabled(markup, "Save draft")).toBe(false);
  });

  it("preserves multiple-account publishing and reel controls with confirmed accounts", () => {
    const accounts = accountsByChannel([account("instagram"), account("instagram", { id: "creator", label: "Creator", isDefault: false })]);
    const markup = render(accounts, {
      format: "reel", variants: [{ channel: "instagram", text: "A reel", accountId: "creator", accountLabel: "Creator" }],
      media: [{ assetId: "video", name: "fixture.mp4", contentType: "video/mp4", url: "https://example.invalid/fixture.mp4", kind: "video" }],
    });
    expect(disabled(markup, "Publish now")).toBe(false);
    expect(markup).toContain("Instagram account");
    expect(markup).toContain("Creator");
    expect(markup).toContain("Safe zones");
  });

  it.each([null, connected("x")])("keeps a saved explicit account in drafts when its current connection is unavailable (%j)", async (accounts) => {
    cloud.mutation.mockReset().mockResolvedValue("saved");
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(BroadcastComposer, {
        projectId: "project", projectName: "Fixture", posts: [], canEdit: true, accounts, onConnect() {}, onClose() {},
        post: post({ variants: [{ channel: "x", text: "Draft", accountId: "removed-extra", accountLabel: "Founder" }] }),
      })));
      await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Save draft")!.click(); });
      expect(cloud.mutation).toHaveBeenCalledWith("broadcast:save", expect.objectContaining({ variants: [{ channel: "x", text: "Draft", accountId: "removed-extra", accountLabel: "Founder" }] }));
      expect(cloud.mutation).not.toHaveBeenCalledWith("broadcast:schedule", expect.anything());
    } finally { act(() => root.unmount()); }
  });

  it("requires an explicit choice before replacing a removed account with the default", async () => {
    cloud.mutation.mockReset().mockResolvedValue("saved");
    const host = document.createElement("div");
    const root = createRoot(host);
    const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
    try {
      act(() => root.render(createElement(BroadcastComposer, {
        projectId: "project", projectName: "Fixture", posts: [], canEdit: true, accounts: connected("x"), onConnect() {}, onClose() {},
        post: post({ variants: [{ channel: "x", text: "Draft", accountId: "removed-extra", accountLabel: "Founder" }] }),
      })));
      expect(button("Publish now").disabled).toBe(true);
      act(() => button("Use available account").click());
      expect(button("Publish now").disabled).toBe(false);
      await act(async () => { button("Save draft").click(); });
      expect(cloud.mutation).toHaveBeenCalledWith("broadcast:save", expect.objectContaining({ variants: [{ channel: "x", text: "Draft" }] }));
    } finally { act(() => root.unmount()); }
  });

  it("uses the default account first but preserves a valid selected extra account", async () => {
    const accounts = accountsByChannel([account("x", { id: "extra", label: "Extra", isDefault: false }), account("x")]);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      for (const [selected, expected] of [[undefined, { channel: "x", text: "Draft" }], ["extra", { channel: "x", text: "Draft", accountId: "extra", accountLabel: "Extra" }]] as const) {
        cloud.mutation.mockReset().mockResolvedValue("saved");
        act(() => root.render(createElement(BroadcastComposer, {
          key: selected ?? "default", projectId: "project", projectName: "Fixture", posts: [], canEdit: true, accounts, onConnect() {}, onClose() {},
          post: post({ variants: [{ channel: "x", text: "Draft", ...(selected ? { accountId: selected, accountLabel: "Extra" } : {}) }] }),
        })));
        await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Save draft")!.click(); });
        expect(cloud.mutation).toHaveBeenCalledWith("broadcast:save", expect.objectContaining({ variants: [expected] }));
      }
    } finally { act(() => root.unmount()); }
  });
});
