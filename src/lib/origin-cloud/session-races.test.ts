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
const { captureCloudSession, logoutCloud, sessionStore, setCloudUrl, setSessionToken } = await import("./client");
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
  setSessionToken("fixture-session-one");
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

it("rejects a delayed login after an ABA sign-in and sign-out", async () => {
  setSessionToken(null);
  const request = deferred<{ sessionToken: string }>(); fixture.action.mockReturnValue(request.promise);
  await act(async () => root.render(createElement(Session)));
  let pending!: Promise<unknown>;
  await act(async () => { pending = session.login("member@example.test", "fixture-password").then(() => null, error => error); });
  await act(async () => setSessionToken("fixture-session-two"));
  await act(async () => setSessionToken(null));
  let result: unknown;
  await act(async () => { request.resolve({ sessionToken: "fixture-stale-login" }); result = await pending; });
  expect.soft(result).toBeInstanceOf(Error);
  expect(sessionStore.get()).toBeNull();
});

it("rejects a delayed login after an ABA backend switch from storage events", async () => {
  setSessionToken(null);
  const request = deferred<{ sessionToken: string }>(); fixture.action.mockReturnValue(request.promise);
  await act(async () => root.render(createElement(Session)));
  let pending!: Promise<unknown>;
  await act(async () => { pending = session.login("member@example.test", "fixture-password").then(() => null, error => error); });
  for (const [oldValue, newValue] of [
    ["http://127.0.0.1:43001", "http://127.0.0.1:43002"],
    ["http://127.0.0.1:43002", "http://127.0.0.1:43001"],
  ]) {
    await act(async () => {
      localStorage.setItem("origin-cloud-url", newValue!);
      window.dispatchEvent(new StorageEvent("storage", { key: "origin-cloud-url", oldValue, newValue }));
    });
  }
  let result: unknown;
  await act(async () => { request.resolve({ sessionToken: "fixture-stale-login" }); result = await pending; });
  expect.soft(result).toBeInstanceOf(Error);
  expect(sessionStore.get()).toBeNull();
});

it("ignores unrelated storage events and invalidates captured ownership on storage clear", () => {
  const captured = captureCloudSession();
  window.dispatchEvent(new StorageEvent("storage", { key: "fixture-unrelated" }));
  expect(captured.isCurrent()).toBe(true);
  expect(() => captured.assertCurrent()).not.toThrow();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(captured.isCurrent()).toBe(false);
  expect(() => captured.assertCurrent()).toThrow("Your Origin account or connection changed");
  expect(sessionStore.get()).toBe("fixture-session-one");
  expect(captureCloudSession().isCurrent()).toBe(true);
});

it("never dispatches the previous backend's token when changing the backend", async () => {
  await act(async () => root.render(createElement(Session)));
  expect(fixture.queries).toContainEqual({ url: "http://127.0.0.1:43001", token: "fixture-session-one" });
  await act(async () => setCloudUrl("http://127.0.0.1:43002"));
  expect.soft(fixture.queries).not.toContainEqual({ url: "http://127.0.0.1:43002", token: "fixture-session-one" });
  expect.soft(sessionStore.get()).toBeNull();
  expect.soft(host.textContent).toBe("signed out");
  await act(async () => setSessionToken("fixture-session-two"));
  expect(fixture.queries).toContainEqual({ url: "http://127.0.0.1:43002", token: "fixture-session-two" });
});

it("preserves the session when a differently written address selects the same canonical backend", async () => {
  await act(async () => root.render(createElement(Session)));
  await act(async () => setCloudUrl(" http://127.0.0.1:43001/same-server "));
  expect(sessionStore.get()).toBe("fixture-session-one");
  expect(host.textContent).toBe("fixture-session-one");
  expect(fixture.queries.every(query => query.url === "http://127.0.0.1:43001")).toBe(true);
});

it("refuses a backend switch if the previous token cannot be removed", async () => {
  await act(async () => root.render(createElement(Session)));
  const remove = vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new Error("Fixture storage removal denied"); });
  try {
    await act(async () => { expect(() => setCloudUrl("http://127.0.0.1:43002")).toThrow("Origin could not clear the previous account"); });
    expect(captureCloudSession().url).toBe("http://127.0.0.1:43001");
    expect(sessionStore.get()).toBe("fixture-session-one");
    expect(fixture.queries.every(query => query.url === "http://127.0.0.1:43001")).toBe(true);
  } finally {
    remove.mockRestore();
  }
});

it("reports a denied URL write and removes authenticated UI after clearing its token", async () => {
  await act(async () => root.render(createElement(Session)));
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Fixture storage write denied"); });
  try {
    await act(async () => { expect(() => setCloudUrl("http://127.0.0.1:43002")).toThrow("Origin could not save the connection"); });
    expect(captureCloudSession().url).toBe("http://127.0.0.1:43001");
    expect(sessionStore.get()).toBeNull();
    expect(host.textContent).toBe("signed out");
    expect(fixture.queries.every(query => query.url === "http://127.0.0.1:43001")).toBe(true);
  } finally {
    write.mockRestore();
  }
});
