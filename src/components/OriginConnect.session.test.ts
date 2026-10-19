// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { OriginConnectDialog, shareSession } from "./OriginConnect";
import { captureCloudSession, setCloudUrl, setSessionToken } from "@/lib/origin-cloud/client";

const fixture = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("convex/react", () => ({ ConvexReactClient: class {
  action = fixture.action;
  close = async () => {};
  query = async () => ({ _id: "fixture-member", name: "Fixture member", email: "member@example.test" });
  watchQuery = () => ({ localQueryResult: () => ({ _id: "fixture-member", name: "Fixture member", email: "member@example.test" }), onUpdate: () => () => {} });
} }));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setCloudUrl("http://127.0.0.1:43001");
  setSessionToken("fixture-session-one");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  fixture.action.mockReset();
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("does not forward a superseded account to the local server", async () => {
  setSessionToken("fixture-session-two");
  await shareSession("http://127.0.0.1:43001", "fixture-session-one");
  expect(fetch).not.toHaveBeenCalled();
});

it("does not pair the new account token with an older connection dialog's backend", async () => {
  setCloudUrl("http://127.0.0.1:43002"); setSessionToken("fixture-session-two");
  await shareSession("http://127.0.0.1:43001", "fixture-session-two");
  expect(fetch).not.toHaveBeenCalled();
});

it("an older logout cannot delete the current account's server connection", async () => {
  setSessionToken("fixture-session-two");
  await shareSession(null, null);
  expect(fetch).not.toHaveBeenCalled();
});

it("shares the current session with the local server", async () => {
  await shareSession("http://127.0.0.1:43001", "fixture-session-one");
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/origin/cloud-session", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1:43001", sessionToken: "fixture-session-one" }),
  });
});

it("clears the server connection after the current account signs out", async () => {
  setSessionToken(null);
  await shareSession(null, null);
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/origin/cloud-session", { method: "DELETE" });
});

it("a current sign-in attempt can hand off its result before installing the browser session", async () => {
  setSessionToken(null);
  await shareSession("http://127.0.0.1:43001", "fixture-login-result", captureCloudSession());
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/origin/cloud-session", expect.objectContaining({
    method: "PUT", body: JSON.stringify({ url: "http://127.0.0.1:43001", sessionToken: "fixture-login-result" }),
  }));
});

it("a superseded sign-in attempt cannot hand off even when its old token value returns", async () => {
  setSessionToken(null); const attempt = captureCloudSession();
  setSessionToken("fixture-other-session"); setSessionToken(null);
  await expect(shareSession("http://127.0.0.1:43001", "fixture-login-result", attempt)).rejects.toThrow("Your Origin account or connection changed");
  expect(fetch).not.toHaveBeenCalled();
});

it("an attempt cannot send its token to a different backend", async () => {
  setSessionToken(null);
  await expect(shareSession("http://127.0.0.1:43002", "fixture-login-result", captureCloudSession())).rejects.toThrow("Your Origin connection changed");
  expect(fetch).not.toHaveBeenCalled();
});

it("reports a refused connection instead of proceeding as if sharing succeeded", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "private server details" }), { status: 409 }));
  await expect(shareSession("http://127.0.0.1:43001", "fixture-session-one")).rejects.toThrow("Origin could not connect this account (HTTP 409)");
});

async function signInDialog(address: string) {
  setSessionToken(null);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(OriginConnectDialog, { onClose: () => {} })));
  const input = async (selector: string, value: string) => {
    const field = document.querySelector<HTMLInputElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await input('[placeholder="https://your-deployment.convex.cloud"]', address);
  await input('[autocomplete="username"]', "member@example.test");
  await input('[autocomplete="current-password"]', "fixture-password");
  return {
    submit: () => act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }),
    close: () => { act(() => root.unmount()); host.remove(); },
  };
}

it.each([
  ["http://127.0.0.1:43001/", "http://127.0.0.1:43001"],
  ["fixture.convex.cloud", "https://fixture.convex.cloud"],
  ["origin.imbored.fun/", "https://wry-fly-446.eu-west-1.convex.cloud"],
])("the actual account dialog shares the canonical backend for %s", async (address, backend) => {
  fixture.action.mockResolvedValue({ sessionToken: "fixture-dialog-session" });
  const dialog = await signInDialog(address);
  try {
    await dialog.submit();
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/origin/cloud-session", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ url: backend, sessionToken: "fixture-dialog-session" }),
    }));
    expect(document.querySelector('[role="alert"]')).toBeNull();
  } finally { dialog.close(); }
});

it("a refused handoff remains visible after the actual dialog signs in", async () => {
  fixture.action.mockResolvedValue({ sessionToken: "fixture-dialog-session" });
  vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 409 }));
  const dialog = await signInDialog("http://127.0.0.1:43001");
  try {
    await dialog.submit();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Signed in as Fixture member");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Origin could not connect this account (HTTP 409)");
  } finally { dialog.close(); }
});
