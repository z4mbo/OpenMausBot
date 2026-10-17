import { describe, expect, it } from "vitest";
import { callJson, callOptions } from "./call-http";

describe("desktop call transport", () => {
  it("allows bearer preflight without cookie credentials", () => {
    const response = callOptions();
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
  it("keeps authenticated failures readable and private to caches", async () => {
    const response = callJson({ error: "Workspace access required" }, { status: 401 });
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Workspace access required" });
  });
});
