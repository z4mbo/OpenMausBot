// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthPage } from "./auth-page";

const fixture = vi.hoisted(() => ({
  invitation: { name: "Fixture workspace", role: "member", email: "member@example.test" } as { name: string; role: string; email?: string } | null | undefined,
  session: { loading: false, token: "fixture-session-one" as string | null, user: { _id: "fixture-user-one", name: "Fixture member", email: "member@example.test" } as { _id: string; name: string; email: string } | null, save: vi.fn(), signOut: vi.fn() },
  accept: vi.fn(),
  action: vi.fn(),
  signupMode: { inviteOnly: true } as { inviteOnly: boolean } | undefined,
  policyQueries: vi.fn(),
}));
vi.mock("@/lib/convex-api", () => ({ api: { workspaces: { invitePreview: "preview", acceptInvite: "accept", list: "workspaces" }, auth: { login: "login", signup: "signup", signupMode: "signupMode" } } }));
vi.mock("convex/react", () => ({ useQuery: (name: string, args: unknown) => {
  if (name === "preview") return args === "skip" ? undefined : fixture.invitation;
  if (name === "signupMode") { fixture.policyQueries(args); return args === "skip" ? undefined : fixture.signupMode; }
  return [];
}, useMutation: () => fixture.accept, useAction: () => fixture.action }));
vi.mock("./brand", () => ({ useOriginSession: () => fixture.session }));
vi.mock("./origin-site", () => ({ SiteFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>, DownloadCard: () => <aside>Download Origin</aside> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));

let host: HTMLDivElement;
let root: Root;
function deferred() {
  let resolve!: (value: { slug: string }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ slug: string }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve: () => resolve({ slug: "fixture-workspace" }), reject };
}
const render = async (inviteToken = "fixture-invite-one") => { await act(async () => root.render(<AuthPage mode="signup" inviteToken={inviteToken} />)); };
function button(text: string) {
  const result = [...host.querySelectorAll("button")].find(item => item.textContent?.includes(text));
  expect(result, `Missing button: ${text}`).toBeDefined();
  return result!;
}
const clickJoin = async () => { await act(async () => button("Join workspace").click()); };
const heading = () => host.querySelector("h1")?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Network is disabled in the invitation fixture"))));
  fixture.invitation = { name: "Fixture workspace", role: "member", email: "member@example.test" };
  fixture.session = { loading: false, token: "fixture-session-one", user: { _id: "fixture-user-one", name: "Fixture member", email: "member@example.test" }, save: vi.fn(), signOut: vi.fn() };
  fixture.accept.mockReset();
  fixture.action.mockReset();
  fixture.signupMode = { inviteOnly: true };
  fixture.policyQueries.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const renderPublicSignup = async (key?: string) => { await act(async () => root.render(<AuthPage key={key} mode="signup" />)); };
const advance = async (milliseconds: number) => { await act(async () => vi.advanceTimersByTime(milliseconds)); };

it("bounds a stalled signup policy and retries its subscription without offering registration", async () => {
  vi.useFakeTimers();
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  await renderPublicSignup();
  await advance(9999);
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  await advance(1);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Check your connection");
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(fixture.policyQueries).toHaveBeenLastCalledWith("skip");
  await act(async () => button("Try again").click());
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(fixture.policyQueries).toHaveBeenLastCalledWith({});
  fixture.signupMode = { inviteOnly: false };
  await renderPublicSignup();
  await advance(20_000);
  expect(host.querySelectorAll("input")).toHaveLength(4);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(fixture.action).not.toHaveBeenCalled();
});

it.each([true, false])("cancels the deadline when signup policy resolves before it: inviteOnly=%s", async inviteOnly => {
  vi.useFakeTimers();
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  await renderPublicSignup();
  await advance(9000);
  fixture.signupMode = { inviteOnly };
  await renderPublicSignup();
  await advance(20_000);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelectorAll("input")).toHaveLength(inviteOnly ? 0 : 4);
  expect(fixture.action).not.toHaveBeenCalled();
});

it("ignores a stale deadline from a replaced signup flow", async () => {
  vi.useFakeTimers();
  const schedule = vi.spyOn(window, "setTimeout");
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  await renderPublicSignup("first");
  const expired = schedule.mock.calls.find(([, delay]) => delay === 10_000)?.[0];
  expect(expired).toBeTypeOf("function");
  await advance(5000);
  await renderPublicSignup("second");
  await act(async () => (expired as () => void)());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  await advance(9999);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await advance(1);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});

it("clears the signup deadline when the flow unmounts", async () => {
  vi.useFakeTimers();
  const schedule = vi.spyOn(window, "setTimeout");
  const cancel = vi.spyOn(window, "clearTimeout");
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  await renderPublicSignup();
  const index = schedule.mock.calls.findIndex(([, delay]) => delay === 10_000);
  expect(index).toBeGreaterThanOrEqual(0);
  const timer = schedule.mock.results[index].value;
  await act(async () => root.render(null));
  expect(cancel).toHaveBeenCalledWith(timer);
  await advance(20_000);
  expect(host.childElementCount).toBe(0);
});

it.each(["signin", "invitation"] as const)("does not start a signup deadline for %s", async route => {
  vi.useFakeTimers();
  const schedule = vi.spyOn(window, "setTimeout");
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  await act(async () => root.render(<AuthPage mode={route === "signin" ? "signin" : "signup"} inviteToken={route === "invitation" ? "fixture-invite-one" : undefined} />));
  await advance(20_000);
  expect(schedule.mock.calls.some(([, delay]) => delay === 10_000)).toBe(false);
  expect(fixture.policyQueries).toHaveBeenLastCalledWith("skip");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelectorAll("input")).toHaveLength(route === "signin" ? 2 : 3);
});

it("waits for signup policy before showing fields on an invite-only instance", async () => {
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  const signup = async () => { await act(async () => root.render(<AuthPage mode="signup" />)); };
  await signup();
  expect(heading()).toBe("Create your Origin account");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading");
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelectorAll("input")).toHaveLength(0);
  fixture.signupMode = { inviteOnly: true };
  await signup();
  expect(host.textContent).toContain("Origin is invite-only for now.");
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(fixture.action).not.toHaveBeenCalled();
});

it("shows signup fields only after the policy permits public registration", async () => {
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  const signup = async () => { await act(async () => root.render(<AuthPage mode="signup" />)); };
  await signup();
  expect(host.querySelector("form")).toBeNull();
  fixture.signupMode = { inviteOnly: false };
  await signup();
  expect(host.querySelectorAll("input")).toHaveLength(4);
  expect(button("Create account").disabled).toBe(false);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(fixture.action).not.toHaveBeenCalled();
});

it("keeps sign-in available while the public signup policy loads", async () => {
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  await act(async () => root.render(<AuthPage mode="signin" />));
  expect(heading()).toBe("Sign in to Origin");
  expect(host.querySelectorAll("input")).toHaveLength(2);
  expect(button("Sign in").disabled).toBe(false);
  expect(fixture.action).not.toHaveBeenCalled();
});

it("keeps a verified invitation signup available while public signup policy loads", async () => {
  fixture.session = { ...fixture.session, token: null, user: null };
  fixture.signupMode = undefined;
  await render();
  expect(heading()).toBe("Join Fixture workspace");
  expect(host.querySelectorAll("input")).toHaveLength(3);
  expect(button("Create account").disabled).toBe(false);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(fixture.action).not.toHaveBeenCalled();
});

it("keeps pending acceptance and its success when preview invalidates before the mutation resolves", async () => {
  const pending = deferred();
  fixture.accept.mockReturnValue(pending.promise);
  await render();
  await clickJoin();
  fixture.invitation = null;
  await render();
  expect(heading()).toBe("Join Fixture workspace");
  expect(host.querySelector('[aria-label="Joining"]')).not.toBeNull();
  await act(async () => pending.resolve());
  expect(heading()).toBe("You're in Fixture workspace");
  expect(host.textContent).toContain("member@example.test");
});

it("keeps successful acceptance when preview invalidates after the mutation resolves", async () => {
  fixture.accept.mockResolvedValue({ slug: "fixture-workspace" });
  await render();
  await clickJoin();
  expect(heading()).toBe("You're in Fixture workspace");
  fixture.invitation = null;
  await render();
  expect(heading()).toBe("You're in Fixture workspace");
});

it("shows unavailable for an initially expired, revoked or used invitation without accepting", async () => {
  fixture.invitation = null;
  await render();
  expect(heading()).toBe("Invitation unavailable");
  expect(fixture.accept).not.toHaveBeenCalled();
});

it("never claims success when an invalidated pending acceptance is rejected", async () => {
  const pending = deferred();
  fixture.accept.mockReturnValue(pending.promise);
  await render();
  await clickJoin();
  fixture.invitation = null;
  await render();
  await act(async () => pending.reject(new Error("This invitation was revoked")));
  expect(heading()).toBe("Invitation unavailable");
  expect(host.textContent).not.toContain("You're in");
});

it("retains a wrong-email denial and permits another attempt without claiming membership", async () => {
  fixture.accept.mockRejectedValue(new Error("Sign in with invited@example.test to accept this invitation"));
  await render();
  await clickJoin();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Sign in with invited@example.test");
  expect(heading()).toBe("Join Fixture workspace");
  expect(button("Join workspace").disabled).toBe(false);
});

it("admits only one acceptance from same-render clicks", async () => {
  const pending = deferred();
  fixture.accept.mockReturnValue(pending.promise);
  await render();
  const join = button("Join workspace");
  await act(async () => {
    join.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    join.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(fixture.accept).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
});

it("does not carry pending completion into another invite", async () => {
  const pending = deferred();
  fixture.accept.mockReturnValue(pending.promise);
  await render();
  await clickJoin();
  fixture.invitation = { name: "Other workspace", role: "viewer" };
  await render("fixture-invite-two");
  await act(async () => pending.resolve());
  expect(heading()).toBe("Join Other workspace");
  expect(button("Join workspace").disabled).toBe(false);
});

it("does not carry successful acceptance into another session for the same account", async () => {
  fixture.accept.mockResolvedValue({ slug: "fixture-workspace" });
  await render();
  await clickJoin();
  fixture.session = { ...fixture.session, token: "fixture-session-two" };
  await render();
  expect(heading()).toBe("Join Fixture workspace");
});

it("does not carry an old account's pending completion into the new account", async () => {
  const pending = deferred();
  fixture.accept.mockReturnValue(pending.promise);
  await render();
  await clickJoin();
  fixture.session = { ...fixture.session, token: "fixture-session-two", user: { _id: "fixture-user-two", name: "Other member", email: "other@example.test" } };
  await render();
  await act(async () => pending.resolve());
  expect(heading()).toBe("Join Fixture workspace");
  expect(host.textContent).toContain("other@example.test");
  expect(host.textContent).not.toContain("You're in");
});

it("does not restore pending acceptance after signing out", async () => {
  const pending = deferred();
  fixture.accept.mockReturnValue(pending.promise);
  fixture.session.signOut.mockImplementation(async () => { fixture.session = { ...fixture.session, token: null, user: null }; });
  await render();
  await clickJoin();
  await act(async () => button("Use another account").click());
  await render();
  await act(async () => pending.resolve());
  expect(host.querySelector("form")).not.toBeNull();
  expect(host.textContent).not.toContain("You're in");
  expect(fixture.session.signOut).toHaveBeenCalledOnce();
});

it("clears success when the account changes without a new session token", async () => {
  fixture.accept.mockResolvedValue({ slug: "fixture-workspace" });
  await render();
  await clickJoin();
  fixture.session = { ...fixture.session, user: { _id: "fixture-user-two", name: "Other member", email: "other@example.test" } };
  await render();
  expect(heading()).toBe("Join Fixture workspace");
  expect(host.textContent).toContain("other@example.test");
});
