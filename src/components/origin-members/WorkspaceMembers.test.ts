// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMembersPanel } from "./WorkspaceMembers";

const fixture = vi.hoisted(() => ({
  url: "https://wry-fly-446.eu-west-1.convex.cloud", token: "synthetic-session", user: "owner", teamId: "team1",
  copy: vi.fn(async () => "copied"), fetch: vi.fn(), post: vi.fn(),
}));
vi.mock("@/lib/origin-cloud", () => ({
  cloudUrl: () => fixture.url, cloudMutation: vi.fn(), setCloudUrl: vi.fn(),
  useCloudUrl: () => fixture.url,
  useCloudSession: () => ({ ready: true, token: fixture.token, user: { _id: fixture.user, email: "owner@example.test" } }),
  useCloudQuery: (name: string) => name === "workspaces:access" ? { teamId: fixture.teamId, role: "owner" }
    : name === "workspaces:members" ? [{ _id: fixture.user, name: "Owner", email: "owner@example.test", role: "owner", avatarUrl: null }]
      : name === "workspaces:invitations" ? [{ _id: "invite1", teamId: fixture.teamId, token: "a".repeat(64), role: "member", expiresAt: Date.now() + 86_400_000, createdAt: 0 }] : undefined,
}));
vi.mock("@/lib/origin-cloud/client", () => ({ sessionStore: { get: () => fixture.token } }));
vi.mock("@/lib/origin-cloud/hooks", () => ({ useCloudToken: () => fixture.token }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => ({ projects: {}, workspaces: {} }), linkCloudRecord: vi.fn() }));
vi.mock("@/lib/origin-sync", () => ({ requestOriginSync: vi.fn() }));
vi.mock("@/lib/copy-text", () => ({ copyText: fixture.copy }));
vi.mock("../OriginConnect", () => ({ OriginConnectDialog: () => null }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  fixture.url = "https://wry-fly-446.eu-west-1.convex.cloud";
  fixture.token = "synthetic-session"; fixture.user = "owner"; fixture.teamId = "team1";
  fixture.copy.mockClear(); fixture.fetch.mockReset(); fixture.post.mockReset();
  fixture.post.mockResolvedValue(response({ token: "b".repeat(64), expiresAt: 123, inviteLink: `http://127.0.0.1:45678/join/${"b".repeat(64)}`, sent: true, deliveryStatus: "accepted" }));
  fixture.fetch.mockImplementation(async (url: string) => url === "/api/origin/invites" ? fixture.post()
    : response(url === "/api/origin/invite-address" ? { origin: "https://origin.imbored.fun", convexUrl: fixture.url } : { origin: null }));
  vi.stubGlobal("fetch", fixture.fetch);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window.location, "origin", "get").mockReturnValue("http://127.0.0.1:45678");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = async () => act(async () => root.render(createElement(WorkspaceMembersPanel, { cloudTeamId: fixture.teamId })));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const submit = () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const enterEmail = async () => act(async () => {
  const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "guest@example.test");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("Origin workspace invitations", () => {
  it("copies the public join address for a pending invite on a loopback desktop", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Copy invite link"]')!.click());
    expect(fixture.copy).toHaveBeenCalledExactlyOnceWith(`https://origin.imbored.fun/join/${"a".repeat(64)}`);
  });
  it("offers email invitations and displays the public created link after provider acceptance", async () => {
    await render(); await enterEmail();
    expect(host.textContent).toContain("Send email invite");
    await act(async () => { submit(); });
    expect(host.textContent).toContain("Invitation sent to guest@example.test.");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Invitation link"]')!.value).toBe(`https://origin.imbored.fun/join/${"b".repeat(64)}`);
    const request = fixture.fetch.mock.calls.find(([url]) => url === "/api/origin/invites")!;
    expect(JSON.parse(request[1].body)).toMatchObject({ teamId: "team1", email: "guest@example.test", role: "member", convexUrl: fixture.url });
  });
  it.each([
    ["not_configured", "Email invitations are not available for this Origin connection."],
    ["failed", "The invitation was created, but the email could not be sent."],
    [undefined, "The invitation was created, but the email could not be sent."],
  ])("keeps a public copyable link and truthful notice when email status is %s", async (deliveryStatus, note) => {
    fixture.post.mockResolvedValue(response({ token: "b".repeat(64), expiresAt: 123, inviteLink: "http://localhost:3000/join/old", sent: false, deliveryStatus }));
    await render(); await enterEmail(); await act(async () => { submit(); });
    expect(host.textContent).toContain(note); expect(host.textContent).not.toContain("Invitation sent to");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Invitation link"]')!.value).toBe(`https://origin.imbored.fun/join/${"b".repeat(64)}`);
    const copy = host.querySelector('input[aria-label="Invitation link"]')!.parentElement!.querySelector<HTMLButtonElement>("button")!;
    await act(async () => copy.click());
    expect(fixture.copy).toHaveBeenCalledWith(`https://origin.imbored.fun/join/${"b".repeat(64)}`);
  });
  it("does not claim acceptance when a failed status contradicts the legacy boolean", async () => {
    fixture.post.mockResolvedValue(response({ token: "b".repeat(64), expiresAt: 123, inviteLink: "https://origin.imbored.fun/join/old", sent: true, deliveryStatus: "failed" }));
    await render(); await enterEmail(); await act(async () => { submit(); });
    expect(host.textContent).toContain("email could not be sent"); expect(host.textContent).not.toContain("Invitation sent to");
  });
  it("accepts the compatible legacy sent boolean when no delivery status exists", async () => {
    fixture.post.mockResolvedValue(response({ token: "b".repeat(64), expiresAt: 123, inviteLink: "https://origin.imbored.fun/join/old", sent: true }));
    await render(); await enterEmail(); await act(async () => { submit(); });
    expect(host.textContent).toContain("Invitation sent to guest@example.test.");
  });
  it("sends only once for two synchronous submits and disables controls while pending", async () => {
    const pending = deferred<Response>(); fixture.post.mockReturnValue(pending.promise);
    await render(); await enterEmail();
    await act(async () => { submit(); submit(); });
    expect(fixture.post).toHaveBeenCalledOnce();
    expect(host.querySelector<HTMLInputElement>('input[type="email"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
    await act(async () => pending.resolve(response({ token: "b".repeat(64), expiresAt: 123, inviteLink: "https://origin.imbored.fun/join/old", sent: true, deliveryStatus: "accepted" })));
    expect(host.querySelector<HTMLInputElement>('input[type="email"]')!.disabled).toBe(false);
  });
  it("ignores the old account's pending result after switching accounts", async () => {
    const pending = deferred<Response>(); fixture.post.mockReturnValue(pending.promise);
    await render(); await enterEmail(); await act(async () => { submit(); });
    fixture.user = "new-owner"; fixture.token = "another-synthetic-session"; await render();
    await act(async () => pending.resolve(response({ error: "Private old-account error" }, 403)));
    expect(host.querySelector('input[aria-label="Invitation link"]')).toBeNull();
    expect(host.textContent).not.toContain("Private old-account error");
    expect(host.textContent).not.toContain("Invitation sent to");
  });
  it("disables pending-invite copy for an unresolved custom connection and enables it only after a matching reply", async () => {
    fixture.url = "https://custom.example.convex.cloud";
    const pending = deferred<Response>(); fixture.fetch.mockReturnValue(pending.promise);
    await render();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Copy invite link"]')!.disabled).toBe(true);
    expect(host.textContent).toContain("Invitation links are unavailable");
    await act(async () => pending.resolve(response({ convexUrl: fixture.url, origin: "https://team.example.test" })));
    const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy invite link"]')!;
    expect(copy.disabled).toBe(false);
    await act(async () => copy.click());
    expect(fixture.copy).toHaveBeenCalledExactlyOnceWith(`https://team.example.test/join/${"a".repeat(64)}`);
  });
  it("retains a current-account creation error without displaying a success link", async () => {
    fixture.post.mockResolvedValue(response({ error: "Origin connection changed. Sign in again." }, 409));
    await render(); await enterEmail(); await act(async () => { submit(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Origin connection changed");
    expect(host.querySelector('input[aria-label="Invitation link"]')).toBeNull();
  });
});
