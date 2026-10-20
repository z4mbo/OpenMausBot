import { describe, expect, it } from "vitest";
import type { ShipDeployment, ShipTarget } from "../../../shared/origin-ship";
import { confirmText, liveDeployment, productionUrl, releaseSteps, shipBrief, timeAgo } from "./ship-model";

const target = (extra: Partial<ShipTarget> = {}): ShipTarget => ({ _id: "t1", provider: "vercel", name: "Production", ref: "app", branch: "main", createdAt: 1, updatedAt: 1, ...extra });
const deployment = (extra: Partial<ShipDeployment>): ShipDeployment => ({ id: "d", state: "ready", createdAt: 1, production: true, actions: [], ...extra });

describe("ship model", () => {
  it("says how long ago in short words", () => {
    const now = Date.UTC(2026, 9, 20, 12);
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2 d ago");
    expect(timeAgo(0, now)).toBe("");
  });

  it("finds what serves production and where", () => {
    const rows = [deployment({ id: "new", state: "building" }), deployment({ id: "live", current: true, url: "https://live.test" }), deployment({ id: "old" })];
    expect(liveDeployment({ targetId: "t1", connected: true, deployments: rows })?.id).toBe("live");
    expect(liveDeployment({ targetId: "t1", connected: true, deployments: [rows[0]!, rows[2]!] })?.id).toBe("old");
    expect(productionUrl(target(), { targetId: "t1", connected: true, deployments: rows })).toBe("https://live.test");
    expect(productionUrl(target({ siteUrl: "https://acme.test" }), undefined)).toBe("https://acme.test");
  });

  it("confirms each action in words that name what changes", () => {
    expect(confirmText(target(), "deploy")).toBe("Deploy main to Production on Vercel?");
    expect(confirmText(target({ provider: "github-actions", ref: "deploy.yml" }), "deploy")).toBe("Run deploy.yml on main?");
    expect(confirmText(target(), "rollback", deployment({ commitSha: "abcdef123" }))).toBe("Roll Production back to this deployment (abcdef1)?");
    expect(releaseSteps({ tag: "v1.2.0", announce: true, targetId: "t1" }, [target()])).toEqual([
      "Tag v1.2.0 on GitHub and publish its notes", "Deploy Production to production", "Draft an announcement in Broadcast for approval",
    ]);
  });

  it("asks the Chief to draft the release with the production target", () => {
    const brief = shipBrief("Acme", [target({ provider: "github-actions", name: "CI" }), target({ name: "Web" })]);
    expect(brief).toContain('origin_release_draft (deploy_target "Web", announce true)');
    expect(shipBrief("Acme", [])).toContain("origin_release_draft (announce true)");
  });
});
