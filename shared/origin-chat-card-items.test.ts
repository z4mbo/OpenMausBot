import { describe, expect, it } from "vitest";
import {
  assetCardItem, callCardItem, campaignCardItem, feedbackCardItem, mediaKindOf, postCardItem, vaultCardItem,
} from "./origin-chat-card-items.ts";
import { capped, redactOriginCard, type OriginChatCard } from "./origin-chat-cards.ts";

describe("chat card items", () => {
  it("keeps a post's approval, schedule, channels and previewable media", () => {
    const item = postCardItem({
      _id: "p1", status: "draft", needsApproval: true, agentName: "Atlas", scheduledAt: 5, format: "reel",
      variants: [{ channel: "x", text: "Hello", result: "failed", error: "rate limited" }, { channel: "myspace", text: "dropped" }],
      media: [{ name: "clip.mp4", kind: "video", url: "https://cdn.test/clip.mp4" }, { name: "brief.pdf", kind: "other", url: null }],
    });
    expect(item).toEqual({
      id: "p1", status: "draft", needsApproval: true, format: "reel", agentName: "Atlas", scheduledAt: 5,
      channels: [{ channel: "x", text: "Hello", result: "failed", error: "rate limited" }],
      media: [{ name: "clip.mp4", kind: "video", url: "https://cdn.test/clip.mp4" }, { name: "brief.pdf", kind: "other" }],
    });
  });

  it("never carries a vault value, username, address or note", () => {
    const item = vaultCardItem({ _id: "c1", title: "Stripe", kind: "api_key", agentUse: true, value: "sk_live_secret", username: "ada", url: "https://stripe.test", notes: "rotate", encrypted: "CIPHER" });
    expect(item).toEqual({ id: "c1", title: "Stripe", kind: "api_key", agentUse: true });
    expect(JSON.stringify(item)).not.toMatch(/sk_live|ada|stripe\.test|rotate|CIPHER/);
  });

  it("reads assets, campaigns, feedback and call notes", () => {
    expect(assetCardItem({ _id: "a1", name: "logo.svg", type: "figma", fileUrl: "https://cdn.test/logo.svg", folder: "Brand" })).toEqual({ id: "a1", name: "logo.svg", type: "figma", kind: "image", url: "https://cdn.test/logo.svg", folder: "Brand" });
    expect(campaignCardItem({ _id: "c1", name: "Launch", status: "running", channels: ["x", "nope"], counts: { posts: 3, published: 1 } }).counts).toEqual({ posts: 3, published: 1, generations: 0, leads: 0, won: 0, openIssues: 0 });
    expect(feedbackCardItem({ _id: "f1", title: "Crash", body: "on save", kind: "bug", status: "weird", createdAt: 9 })).toEqual({ id: "f1", title: "Crash", body: "on save", kind: "bug", status: "new", createdAt: 9 });
    expect(callCardItem({ _id: "n1", callName: "Sync", startedAt: 1, minutes: 30, keyPoints: ["a"], decisions: [], actionItems: [{ title: "Ship", taskId: "t1" }] }).actionItems).toEqual([{ title: "Ship", taskId: "t1" }]);
    expect(mediaKindOf("", "", "theme.mp3")).toBe("audio");
  });

  it("caps a list and redacts every string of a card", () => {
    expect(capped([1, 2, 3], 2)).toEqual({ items: [1, 2], more: 1 });
    expect(capped([1], 2)).toEqual({ items: [1] });
    const card: OriginChatCard = { kind: "vault", projectId: "p", projectName: "Acme", items: [{ id: "c", title: "token SECRET", kind: "secret", agentUse: false }] };
    expect(redactOriginCard(card, (text) => text.replace("SECRET", "***"))).toEqual({ ...card, items: [{ ...card.items[0], title: "token ***" }] });
  });
});
