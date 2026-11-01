import { describe, expect, it } from "vitest";
import { errorText } from "./error-text";

describe("errorText", () => {
  it("extracts the message from a dev Convex error", () => {
    const error = new Error("[CONVEX A(auth:login)] [Request ID: 3ae3d2c4aa9b1124] Server Error\nUncaught Error: Invalid email or password\n    at handler (../convex/auth.ts:86:16)\n\n    at async handler (../convex/auth.ts:140:11)\n  Called by client");
    expect(errorText(error)).toBe("Invalid email or password");
  });
  it("falls back when production redacts the message", () => {
    expect(errorText(new Error("[CONVEX M(tasks:create)] [Request ID: abc] Server Error\n  Called by client"), "Could not create issue")).toBe("Could not create issue");
  });
  it("prefers ConvexError data", () => {
    expect(errorText(Object.assign(new Error("[CONVEX M(x)] Uncaught ConvexError: nope"), { data: "Name is taken" }))).toBe("Name is taken");
    expect(errorText(Object.assign(new Error("x"), { data: { message: "Too large" } }))).toBe("Too large");
  });
  it("keeps plain messages and maps network failures", () => {
    expect(errorText(new Error("Upload too large"))).toBe("Upload too large");
    expect(errorText(new TypeError("Failed to fetch"))).toBe("Can't reach the server. Check your connection.");
    expect(errorText(undefined, "Nope")).toBe("Nope");
  });
});
