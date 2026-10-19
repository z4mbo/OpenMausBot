// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOriginSession } from "./brand";

const fixture = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/lib/convex-api", () => ({ api: { auth: { me: "me", logout: "logout" } } }));
vi.mock("convex/react", () => ({
  useQuery: (_name: string, args: { sessionToken: string } | "skip") => args === "skip" ? undefined : { _id: args.sessionToken, email: "member@example.test" },
  useMutation: () => fixture.logout,
}));
let host: HTMLDivElement;
let root: Root;
let session: ReturnType<typeof useOriginSession>;
function Session() {
  session = useOriginSession();
  return <output>{session.token ?? "signed out"}</output>;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("No network in the session fixture"))));
  fixture.logout.mockReset(); localStorage.clear(); localStorage.setItem("origin.sessionToken", "fixture-session-one");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Session />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each(["success", "failure"] as const)("a delayed sign-out %s preserves a newer cross-tab login", async outcome => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  fixture.logout.mockReturnValue(new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
  let pending!: Promise<void>;
  await act(async () => { pending = session.signOut(); });
  expect(fixture.logout).toHaveBeenCalledWith({ sessionToken: "fixture-session-one" });
  await act(async () => {
    localStorage.setItem("origin.sessionToken", "fixture-session-two");
    window.dispatchEvent(new StorageEvent("storage", { key: "origin.sessionToken" }));
  });
  expect(host.textContent).toBe("fixture-session-two");
  await act(async () => { if (outcome === "success") resolve(); else reject(new Error("Offline")); await pending; });
  expect(localStorage.getItem("origin.sessionToken")).toBe("fixture-session-two");
  expect(host.textContent).toBe("fixture-session-two");
});

it.each(["success", "failure"] as const)("a current-session sign-out %s still clears that session", async outcome => {
  if (outcome === "success") fixture.logout.mockResolvedValue(null); else fixture.logout.mockRejectedValue(new Error("Offline"));
  await act(async () => session.signOut());
  expect(localStorage.getItem("origin.sessionToken")).toBeNull();
  expect(host.textContent).toBe("signed out");
});

it("a completed login from an older form cannot replace a newer cross-tab session", async () => {
  const saveFromOldForm = session.save;
  await act(async () => {
    localStorage.setItem("origin.sessionToken", "fixture-session-two");
    window.dispatchEvent(new StorageEvent("storage", { key: "origin.sessionToken" }));
  });
  await act(async () => {
    expect.soft(() => saveFromOldForm("fixture-stale-login")).toThrow("Your Origin account changed");
  });
  expect(localStorage.getItem("origin.sessionToken")).toBe("fixture-session-two");
});

it("a completed login from the current form stores its session", async () => {
  await act(async () => session.save("fixture-signed-in"));
  expect(localStorage.getItem("origin.sessionToken")).toBe("fixture-signed-in");
  expect(host.textContent).toBe("fixture-signed-in");
});

it("rejects an older form after an ABA cross-tab sign-in and sign-out", async () => {
  fixture.logout.mockResolvedValue(null);
  await act(async () => session.signOut());
  const saveFromOldForm = session.save;
  await act(async () => {
    localStorage.setItem("origin.sessionToken", "fixture-session-two");
    window.dispatchEvent(new StorageEvent("storage", { key: "origin.sessionToken", oldValue: null, newValue: "fixture-session-two" }));
  });
  await act(async () => {
    localStorage.removeItem("origin.sessionToken");
    window.dispatchEvent(new StorageEvent("storage", { key: "origin.sessionToken", oldValue: "fixture-session-two", newValue: null }));
  });
  expect(host.textContent).toBe("signed out");
  await act(async () => {
    expect.soft(() => saveFromOldForm("fixture-stale-login")).toThrow("Your Origin account changed");
  });
  expect.soft(localStorage.getItem("origin.sessionToken")).toBeNull();
  await act(async () => session.save("fixture-current-login"));
  expect(localStorage.getItem("origin.sessionToken")).toBe("fixture-current-login");
});

it("refreshes the current form after batched away-and-back storage changes", async () => {
  const saveFromOldForm = session.save;
  await act(async () => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    localStorage.setItem("origin.sessionToken", "fixture-session-one");
    window.dispatchEvent(new StorageEvent("storage", { key: "origin.sessionToken", oldValue: null, newValue: "fixture-session-one" }));
  });
  expect(() => saveFromOldForm("fixture-stale-login")).toThrow("Your Origin account changed");
  await act(async () => session.save("fixture-current-login"));
  expect(localStorage.getItem("origin.sessionToken")).toBe("fixture-current-login");
  expect(host.textContent).toBe("fixture-current-login");
});

it("keeps the current form usable after unrelated storage changes", async () => {
  const saveFromCurrentForm = session.save;
  await act(async () => {
    localStorage.setItem("fixture-unrelated", "value");
    window.dispatchEvent(new StorageEvent("storage", { key: "fixture-unrelated", oldValue: null, newValue: "value" }));
    saveFromCurrentForm("fixture-current-login");
  });
  expect(host.textContent).toBe("fixture-current-login");
});
