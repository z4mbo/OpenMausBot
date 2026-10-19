// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originMembers, useAppAddress, useOriginInviteAddress } from "./origin-members";

const fixture = vi.hoisted(() => ({ url: "https://wry-fly-446.eu-west-1.convex.cloud" as string | null, token: "synthetic-session" as string | null, fetch: vi.fn() }));
vi.mock("@/lib/origin-cloud", () => ({ cloudUrl: () => fixture.url, useCloudUrl: () => fixture.url, cloudMutation: vi.fn(), useCloudQuery: vi.fn() }));
vi.mock("@/lib/origin-cloud/client", () => ({ sessionStore: { get: () => fixture.token } }));

const OFFICIAL = "https://wry-fly-446.eu-west-1.convex.cloud";
const CUSTOM = "https://custom.example.convex.cloud";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  fixture.url = OFFICIAL; fixture.token = "synthetic-session"; fixture.fetch.mockReset();
  vi.stubGlobal("fetch", fixture.fetch); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const Probe = () => createElement("output", null, useOriginInviteAddress() ?? "unavailable");
const render = () => act(async () => root.render(createElement(Probe)));

describe("the public address for Origin workspace invitations", () => {
  it("uses the official website immediately while the desktop request is pending", async () => {
    fixture.fetch.mockReturnValue(new Promise(() => {}));
    vi.spyOn(window.location, "origin", "get").mockReturnValue("http://127.0.0.1:45678");
    await render();
    expect(host.textContent).toBe("https://origin.imbored.fun");
    expect(fixture.fetch).toHaveBeenCalledWith("/api/origin/invite-address", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it("retains the known official website if the server request fails", async () => {
    fixture.fetch.mockRejectedValue(new Error("synthetic offline")); await render();
    expect(host.textContent).toBe("https://origin.imbored.fun");
  });
  it("waits for an authoritative public address for a custom backend", async () => {
    fixture.url = CUSTOM;
    const pending = deferred<Response>(); fixture.fetch.mockReturnValue(pending.promise);
    await render(); expect(host.textContent).toBe("unavailable");
    await act(async () => pending.resolve(json({ convexUrl: CUSTOM, origin: "https://team.example.test" })));
    expect(host.textContent).toBe("https://team.example.test");
  });
  it("rejects a server address issued for another backend", async () => {
    fixture.url = CUSTOM; fixture.fetch.mockResolvedValue(json({ convexUrl: OFFICIAL, origin: "https://origin.imbored.fun" }));
    await render(); expect(host.textContent).toBe("unavailable");
  });
  it.each(["http://localhost:3000", "https://127.0.0.1", "https://user:password@team.example.test", "https://team.example.test/path", "https://team.example.test?query=1"])("rejects an unsafe custom application address (%s)", async origin => {
    fixture.url = CUSTOM; fixture.fetch.mockResolvedValue(json({ convexUrl: CUSTOM, origin }));
    await render(); expect(host.textContent).toBe("unavailable");
  });
  it("clears the previous connection immediately and ignores its late reply", async () => {
    fixture.url = CUSTOM;
    const old = deferred<Response>(); const current = deferred<Response>();
    fixture.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await render();
    const oldSignal = fixture.fetch.mock.calls[0][1].signal as AbortSignal;
    fixture.url = "https://second.example.convex.cloud"; await render();
    expect(oldSignal.aborted).toBe(true); expect(host.textContent).toBe("unavailable");
    await act(async () => current.resolve(json({ convexUrl: fixture.url, origin: "https://second.example.test" })));
    await act(async () => old.resolve(json({ convexUrl: CUSTOM, origin: "https://old.example.test" })));
    expect(host.textContent).toBe("https://second.example.test");
  });
  it("does not reuse a resolved custom address after changing connections", async () => {
    fixture.url = CUSTOM; fixture.fetch.mockResolvedValueOnce(json({ convexUrl: CUSTOM, origin: "https://team.example.test" }));
    await render(); expect(host.textContent).toBe("https://team.example.test");
    fixture.fetch.mockReturnValue(new Promise(() => {})); fixture.url = "https://second.example.convex.cloud";
    await render(); expect(host.textContent).toBe("unavailable");
  });
  it("does not revive an old address when switching away and back before the next reply", async () => {
    fixture.url = CUSTOM; fixture.fetch.mockResolvedValueOnce(json({ convexUrl: CUSTOM, origin: "https://old.example.test" }));
    await render(); expect(host.textContent).toBe("https://old.example.test");
    fixture.fetch.mockReturnValue(new Promise(() => {})); fixture.url = "https://second.example.convex.cloud";
    await render(); fixture.url = CUSTOM; await render();
    expect(host.textContent).toBe("unavailable");
  });
  it("makes no request without an Origin connection", async () => {
    fixture.url = null; await render(); expect(host.textContent).toBe("unavailable"); expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("keeps the separate server address behavior for feedback", async () => {
    vi.spyOn(window.location, "origin", "get").mockReturnValue("http://127.0.0.1:45678");
    fixture.fetch.mockResolvedValue(json({ origin: null }));
    const FeedbackAddress = () => createElement("output", null, useAppAddress());
    await act(async () => root.render(createElement(FeedbackAddress)));
    expect(host.textContent).toBe("http://127.0.0.1:45678");
    expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith("/api/origin/app-address");
  });
});

const created = (inviteLink: string) => ({ token: "b".repeat(64), expiresAt: 123, inviteLink, sent: true, deliveryStatus: "accepted" });
describe("creating an invitation from the current Origin account", () => {
  it("sends the expected backend and repairs an old desktop loopback link for the official connection", async () => {
    fixture.fetch.mockResolvedValue(json(created("http://127.0.0.1:45678/join/old")));
    const result = await originMembers.createInvite({ teamId: "team1", role: "member", email: "guest@example.test" });
    expect(result.inviteLink).toBe(`https://origin.imbored.fun/join/${"b".repeat(64)}`);
    expect(result.deliveryStatus).toBe("accepted"); expect(result.sent).toBe(true);
    expect(JSON.parse(fixture.fetch.mock.calls[0][1].body)).toEqual({ teamId: "team1", role: "member", email: "guest@example.test", convexUrl: OFFICIAL, sessionToken: "synthetic-session" });
  });
  it("keeps a public custom website bound to its selected backend", async () => {
    fixture.url = CUSTOM; fixture.fetch.mockResolvedValue(json(created("https://team.example.test/join/token")));
    expect((await originMembers.createInvite({ teamId: "team1", role: "viewer" })).inviteLink).toBe(`https://team.example.test/join/${"b".repeat(64)}`);
  });
  it("rejects a loopback response for an unknown custom backend", async () => {
    fixture.url = CUSTOM; fixture.fetch.mockResolvedValue(json(created("http://localhost:3000/join/token")));
    await expect(originMembers.createInvite({ teamId: "team1", role: "member" })).rejects.toThrow("needs a public address");
  });
  it.each(["account", "connection"])("rejects a late response after the %s changes", async kind => {
    const pending = deferred<Response>(); fixture.fetch.mockReturnValue(pending.promise);
    const result = originMembers.createInvite({ teamId: "team1", role: "member" });
    const rejected = expect(result).rejects.toThrow("account or connection changed");
    if (kind === "account") fixture.token = "another-synthetic-session";
    else fixture.url = CUSTOM;
    pending.resolve(json({ error: "Private old-account error" }, 403));
    await rejected;
  });
  it.each(["account", "connection"])("does not create an invitation without a signed-in %s", async kind => {
    if (kind === "account") fixture.token = null; else fixture.url = null;
    await expect(originMembers.createInvite({ teamId: "team1", role: "member" })).rejects.toThrow(kind === "account" ? "Sign in" : "Connect");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("preserves a current account's safe server error", async () => {
    fixture.fetch.mockResolvedValue(json({ error: "Only workspace admins can invite people" }, 403));
    await expect(originMembers.createInvite({ teamId: "team1", role: "member" })).rejects.toThrow("Only workspace admins");
  });
  it("rejects a malformed token instead of placing it in a public join path", async () => {
    fixture.fetch.mockResolvedValue(json({ ...created("https://origin.imbored.fun/join/old"), token: "../invalid" }));
    await expect(originMembers.createInvite({ teamId: "team1", role: "member" })).rejects.toThrow("Invitation failed");
  });
});
