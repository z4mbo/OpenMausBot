import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createUpdateChecker, isNewerVersion, LATEST_RELEASE_URL } from "./update-check.ts";

describe("Origin server update channel", () => {
  it("queries Origin releases and recognizes its canonical tags", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      tag_name: "origin-v0.2.11",
      html_url: "https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.11",
    }), { status: 200 }));
    const result = await createUpdateChecker({ current: "0.2.10", install: "git", fetch })();
    expect(fetch.mock.calls[0]).toEqual([
      "https://api.github.com/repos/z4mbo/Origin/releases/latest",
      expect.objectContaining({ headers: expect.objectContaining({ "user-agent": "origin-update-check" }) }),
    ]);
    expect(LATEST_RELEASE_URL).toBe("https://api.github.com/repos/z4mbo/Origin/releases/latest");
    expect(result).toMatchObject({
      latest: "0.2.11", available: true,
      releaseUrl: "https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.11",
    });
  });

  it("orders Origin releases without treating held candidate tags as releases", () => {
    expect(isNewerVersion("origin-v0.2.12", "0.2.11")).toBe(true);
    expect(isNewerVersion("origin-v0.2.12-rc.2", "origin-v0.2.12-rc.1")).toBe(true);
    expect(isNewerVersion("origin-v0.2.11", "origin-v0.2.12")).toBe(false);
    expect(isNewerVersion("origin-candidate-v0.2.12-d09a92021", "0.2.11")).toBe(false);
  });

  it("does not recommend replacing a private Origin npm install with upstream", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ tag_name: "origin-v0.2.11" })));
    const result = await createUpdateChecker({ current: "0.2.10", install: "npm", fetch })();
    expect(result).not.toHaveProperty("command");
    expect(result).not.toHaveProperty("restart");
  });

  it("builds Docker updates from the Origin checkout instead of pulling an upstream image", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ tag_name: "origin-v0.2.11" })));
    const result = await createUpdateChecker({ current: "0.2.10", install: "docker", fetch })();
    expect(result.command).toBe("git pull && docker compose up -d --build");
    const compose = readFileSync(new URL("../deploy/docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("image: origin-server:local");
    expect(compose).not.toContain("ghcr.io/milind-soni/openmausbot");
  });
});
