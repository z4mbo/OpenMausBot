// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const fixture = vi.hoisted(() => ({ action: vi.fn(), mutation: vi.fn(), queries: [] as { url: string; token: unknown }[] }));
vi.mock("convex/react", () => ({ ConvexReactClient: class {
  constructor(private readonly url: string) {}
  action = fixture.action;
  mutation = fixture.mutation;
  close = async () => {};
  query = async (_reference: unknown, args: { sessionToken: string }) => {
    fixture.queries.push({ url: this.url, token: args.sessionToken });
    return { _id: "fixture-user", email: "member@example.test" };
  };
  watchQuery = (_reference: unknown, args: { sessionToken: string }) => {
    fixture.queries.push({ url: this.url, token: args.sessionToken });
    return { localQueryResult: () => ({ _id: "fixture-user", email: "member@example.test" }), onUpdate: () => () => {} };
  };
} }));
const { logoutCloud, sessionStore, setCloudUrl, setSessionToken } = await import("./client");
const { useCloudSession } = await import("./hooks");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let host: HTMLDivElement;
let root: Root;
let session: ReturnType<typeof useCloudSession>;
function Session() {
  session = useCloudSession();
  return createElement("output", null, session.token ?? "signed out");
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("No network in the session fixture"))));
  fixture.action.mockReset(); fixture.mutation.mockReset(); fixture.queries = [];
  localStorage.clear();
  setCloudUrl("http://127.0.0.1:43001");
  setSessionToken("fixture-session-one");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each(["success", "failure"] as const)("a delayed logout %s preserves a replacement session", async outcome => {
  const request = deferred<null>();
  fixture.mutation.mockReturnValue(request.promise);
  const pending = logoutCloud().catch(() => {});
  expect(getFunctionName(fixture.mutation.mock.calls[0]![0])).toBe("auth:logout");
  expect(fixture.mutation.mock.calls[0]![1]).toEqual({ sessionToken: "fixture-session-one" });
  setSessionToken("fixture-session-two");
  if (outcome === "success") request.resolve(null); else request.reject(new Error("Offline"));
  await pending;
  expect(sessionStore.get()).toBe("fixture-session-two");
});

it("a delayed logout preserves another backend's session even when token text matches", async () => {
  const request = deferred<null>(); fixture.mutation.mockReturnValue(request.promise);
  const pending = logoutCloud();
  setCloudUrl("http://127.0.0.1:43002");
  request.resolve(null); await pending;
  expect(sessionStore.get()).toBe("fixture-session-one");
});

it.each(["success", "failure"] as const)("a current-session logout %s still clears that session", async outcome => {
  if (outcome === "success") fixture.mutation.mockResolvedValue(null); else fixture.mutation.mockRejectedValue(new Error("Offline"));
  await logoutCloud().catch(() => {});
  expect(sessionStore.get()).toBeNull();
});

it("rejects a delayed login after a backend switch without sending its token to the new backend", async () => {
  setSessionToken(null);
  const request = deferred<{ sessionToken: string }>(); fixture.action.mockReturnValue(request.promise);
  await act(async () => root.render(createElement(Session)));
  let pending!: Promise<void>;
  await act(async () => { pending = session.login("member@example.test", "fixture-password").catch(() => {}); });
  await act(async () => setCloudUrl("http://127.0.0.1:43002"));
  await act(async () => { request.resolve({ sessionToken: "fixture-private-token-from-first-backend" }); await pending; });
  expect.soft(sessionStore.get()).toBeNull();
  expect(fixture.queries).not.toContainEqual({ url: "http://127.0.0.1:43002", token: "fixture-private-token-from-first-backend" });
});

it("a delayed login cannot replace a session that was established while it waited", async () => {
  const request = deferred<{ sessionToken: string }>(); fixture.action.mockReturnValue(request.promise);
  await act(async () => root.render(createElement(Session)));
  let pending!: Promise<void>;
  await act(async () => { pending = session.login("other@example.test", "fixture-password").catch(() => {}); });
  await act(async () => setSessionToken("fixture-session-two"));
  await act(async () => { request.resolve({ sessionToken: "fixture-stale-login" }); await pending; });
  expect(sessionStore.get()).toBe("fixture-session-two");
});

it("a login in an unchanged context stores its returned session", async () => {
  fixture.action.mockResolvedValue({ sessionToken: "fixture-signed-in" });
  await act(async () => root.render(createElement(Session)));
  await act(async () => session.login("member@example.test", "fixture-password"));
  expect(sessionStore.get()).toBe("fixture-signed-in");
});
