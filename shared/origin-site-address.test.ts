import { describe, expect, it } from "vitest";
import { normalizeOriginBackendUrl, ORIGIN_HOSTED_CONVEX_URL, resolveOriginSiteAddress } from "./origin-site-address";

describe("Origin invitation website authority", () => {
  it("pins the official backend to its public site ahead of local/control-plane configuration", () => {
    expect(resolveOriginSiteAddress({ convexUrl: `${ORIGIN_HOSTED_CONVEX_URL}/`, siteUrl: "https://other.example", publicUrl: "http://localhost:8799" })).toBe("https://origin.imbored.fun");
  });
  it("uses an explicit public site only for the configured custom backend", () => {
    expect(resolveOriginSiteAddress({ convexUrl: "https://custom.convex.cloud", siteUrl: "https://team.example/", publicUrl: "https://ignored.example" })).toBe("https://team.example");
    expect(resolveOriginSiteAddress({ convexUrl: "http://127.0.0.1:3210", publicUrl: "https://team.example" })).toBe("https://team.example");
  });
  it.each([undefined, "", "https://origin.imbored.fun", "https://origin.imbored.fun.", "http://localhost:3000", "https://localhost", "https://localhost.example.local", "https://127.0.0.1", "https://2130706433", "https://[::1]", "https://user:secret@team.example", "https://team.example/path", "https://team.example?token=x", "https://team.example#x", "not a URL", "javascript:alert(1)"])("refuses an unknown backend's unsafe/unconfigured site %s", siteUrl => {
    expect(resolveOriginSiteAddress({ convexUrl: "https://custom.convex.cloud", siteUrl })).toBeNull();
  });
  it.each([null, "garbage", "https://user:secret@custom.convex.cloud", "https://custom.convex.cloud/path"])("refuses invalid issuing backend %s", convexUrl => {
    expect(resolveOriginSiteAddress({ convexUrl, siteUrl: "https://team.example" })).toBeNull();
  });
  it("normalizes backend origins without accepting paths or credentialed URLs", () => {
    expect(normalizeOriginBackendUrl(" https://CUSTOM.convex.cloud/ ")).toBe("https://custom.convex.cloud");
    expect(normalizeOriginBackendUrl("https://custom.convex.cloud/query")).toBeNull();
  });
});
