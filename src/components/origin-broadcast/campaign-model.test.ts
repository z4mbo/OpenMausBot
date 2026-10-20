import { describe, expect, it } from "vitest";
import type { CampaignPost, CampaignSummary } from "../../../shared/origin-campaigns";
import { campaignSlug, utmCampaignOf } from "../../../shared/origin-campaigns";
import { campaignBrief, formProblem, emptyCampaignForm, metricTotals, timelineOrder, variantState } from "./campaign-model";

const summary: CampaignSummary = {
  _id: "c1", name: "Spring launch", slug: "spring-launch", goal: "200 beta sign-ups", audience: "Indie founders", channels: ["x", "bluesky"],
  startDate: "2026-11-02", endDate: "2026-11-30", budgetNote: "€300", status: "planning",
  counts: { posts: 0, published: 0, generations: 0, leads: 0, won: 0, openIssues: 0 }, createdAt: 1, updatedAt: 1,
};

const post = (id: string, patch: Partial<CampaignPost> = {}): CampaignPost => ({ _id: id, status: "draft", needsApproval: false, excerpt: "", variants: [{ channel: "x" }], ...patch });

describe("campaign slugs and utm tags", () => {
  it("turns names into utm values", () => {
    expect(campaignSlug("Spring Launch! 2026")).toBe("spring-launch-2026");
    expect(campaignSlug("Café crème")).toBe("cafe-creme");
    expect(campaignSlug("!!!")).toBe("campaign");
  });

  it("reads utm_campaign from a page address", () => {
    expect(utmCampaignOf("https://site.test/?utm_source=x&utm_campaign=Spring%20Launch")).toBe("spring launch");
    expect(utmCampaignOf("https://site.test/#utm_campaign=spring-launch")).toBe("spring-launch");
    expect(utmCampaignOf("https://site.test/")).toBeNull();
  });
});

describe("campaign brief", () => {
  it("hands the Chief the facts, the tools and the utm tag", () => {
    const brief = campaignBrief(summary, "Origin");
    expect(brief).toContain('Plan the "Spring launch" campaign in Origin (campaign id c1).');
    expect(brief).toContain("Channels: X, Bluesky");
    expect(brief).toContain("Dates: 2026-11-02 to 2026-11-30");
    expect(brief).toContain("origin_create_issue");
    expect(brief).toContain("origin_studio_generate");
    expect(brief).toContain("origin_broadcast_draft");
    expect(brief).toContain("utm_campaign=spring-launch");
    expect(brief).not.toContain("Already linked");
  });
});

describe("campaign form and timeline", () => {
  it("refuses a nameless campaign or an end before its start", () => {
    expect(formProblem(emptyCampaignForm())).toBe("Name the campaign");
    expect(formProblem({ ...emptyCampaignForm(), name: "A", startDate: "2026-11-02", endDate: "2026-11-01" })).toMatch(/before/);
    expect(formProblem({ ...emptyCampaignForm(), name: "A" })).toBe("");
  });

  it("orders posts by when they go out, unscheduled last", () => {
    const order = timelineOrder([post("none"), post("late", { scheduledAt: 20 }), post("done", { variants: [{ channel: "x", result: "published", publishedAt: 5 }] })]);
    expect(order.map((item) => item._id)).toEqual(["done", "late", "none"]);
  });

  it("states each channel's progress", () => {
    expect(variantState(post("a", { needsApproval: true }), { channel: "x" })).toBe("approval");
    expect(variantState(post("a", { status: "scheduled" }), { channel: "x" })).toBe("scheduled");
    expect(variantState(post("a"), { channel: "x", result: "failed" })).toBe("failed");
    expect(metricTotals([{ postId: "a", channel: "x", likes: 2, reposts: 1, replies: 0, at: 1 }, { postId: "a", channel: "bluesky", likes: 3, reposts: 0, replies: 4, at: 1 }]))
      .toEqual({ likes: 5, reposts: 1, replies: 4 });
  });
});
