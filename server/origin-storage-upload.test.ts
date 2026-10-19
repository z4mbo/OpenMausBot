import { afterEach, describe, expect, it, vi } from "vitest";
import { convexOriginClient } from "./origin-cloud.ts";

afterEach(() => { vi.restoreAllMocks(); });

describe("Origin storage upload destinations", () => {
  it.each([
    ["https://fixture.convex.cloud", "https://fixture.convex.cloud/api/storage/upload?token=fixture", undefined],
    ["https://fixture.convex.cloud", "https://fixture.convex.site/uploads?token=fixture", undefined],
    ["http://127.0.0.1:3210", "http://127.0.0.1:3211/uploads?token=fixture", undefined],
    ["https://cloud.example.test", "https://actions.example.test/uploads?token=fixture", "https://actions.example.test"],
  ])("allows the selected deployment and its HTTP action origin (%s)", async (url, uploadUrl, actionUrl) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ storageId: "fixture-id" }));
    const client = convexOriginClient(url, actionUrl ?? "");
    await expect(client.upload!(uploadUrl, new Uint8Array([1, 2, 3]), "image/png")).resolves.toBe("fixture-id");
    expect(fetcher).toHaveBeenCalledWith(uploadUrl, expect.objectContaining({ method: "POST", headers: { "Content-Type": "image/png" } }));
  });

  it.each([
    "https://attacker.example/uploads",
    "https://fixture.convex.site.attacker.example/uploads",
    "https://other.convex.site/uploads",
    "http://fixture.convex.site/uploads",
  ])("never sends project bytes to an unrelated upload origin (%s)", async uploadUrl => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const client = convexOriginClient("https://fixture.convex.cloud", "");
    await expect(client.upload!(uploadUrl, new Uint8Array([1, 2, 3]), "image/png")).rejects.toThrow("outside its deployment");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires a configured action origin for a custom deployment", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const client = convexOriginClient("https://cloud.example.test", "");
    await expect(client.upload!("https://actions.example.test/uploads", new Uint8Array([1]), "image/png")).rejects.toThrow("outside its deployment");
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => convexOriginClient("https://cloud.example.test", "https://actions.example.test/path")).toThrow("application origin");
  });
});
