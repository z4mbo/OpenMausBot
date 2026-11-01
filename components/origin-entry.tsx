"use client";
import { errorText } from "@/lib/error-text";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useAction, useMutation, useQueries, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { flushSync } from "react-dom";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { WorkspaceContext } from "./workspace-context";
import { WorkspaceSkeleton } from "./content-skeleton";
import { lazyComponent } from "./lazy-component";

const OriginWorkspace = lazyComponent(() => import("./origin-app").then(module => module.OriginWorkspace), <WorkspaceSkeleton />);

// A stored session means the workspace is next: fetch its code while the session and workspaces load.
if (typeof window !== "undefined") {
  try { if (localStorage.getItem("origin.sessionToken")) void OriginWorkspace.preload().catch(() => undefined); } catch { /* Storage blocked: nothing to prefetch for. */ }
}

/** Signed-out paths render nothing until the stored session is read, instead of flashing the workspace skeleton. */
const publicPath = (path: string) => path === "/" || path === "/login" || path === "/signup" || path.startsWith("/join/");
/** A deleted workspace is worth mentioning on the empty screen for a week; the backend keeps notices longer. */
const RECENT_DELETION = 7 * 86_400_000;

export function OriginEntry() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const path = usePathname();
  const router = useRouter();
  const user = useQuery(api.auth.me, token ? { sessionToken: token } : "skip");
  // Workspaces load alongside the session check; an expired session's error is dropped (it shows sign-in instead).
  const listed = useQueries(useMemo((): Parameters<typeof useQueries>[0] => token ? { list: { query: api.workspaces.list, args: { sessionToken: token } } } : {}, [token])).list as FunctionReturnType<typeof api.workspaces.list> | Error | undefined;
  if (user && listed instanceof Error) throw listed;
  const workspaces = user && !(listed instanceof Error) ? listed : undefined;
  const ensureLegacy = useMutation(api.workspaces.ensureLegacyWorkspace);
  const acceptInvite = useMutation(api.workspaces.acceptInvite);
  const logout = useMutation(api.auth.logout);
  const inviteToken = path.startsWith("/join/") ? path.split("/")[2] : undefined;
  const invitation = useQuery(api.workspaces.invitePreview, inviteToken ? { token: inviteToken } : "skip");
  const slug = path.split("/")[1];
  const workspace = workspaces?.find(w => w.slug === slug);
  const redirecting = !inviteToken && ["", "login", "signup"].includes(slug) && Boolean(workspaces?.length);
  useEffect(() => { setToken(localStorage.getItem("origin.sessionToken")); setReady(true); }, []);
  useEffect(() => {
    if (token && user) void ensureLegacy({ sessionToken: token }).catch(error => setNotice(errorText(error, "Could not open your workspace")));
  }, [token, user?._id, ensureLegacy]);
  useEffect(() => {
    if (!token || !user || !workspaces?.length || !redirecting) return;
    const preferred = workspaces.find(w => w.slug === localStorage.getItem("origin.workspace")) || workspaces[0];
    router.replace(`/${preferred.slug}`);
  }, [token, user, workspaces, redirecting, router]);
  const saveSession = async (sessionToken: string, destination?: string | null) => {
    localStorage.setItem("origin.sessionToken", sessionToken);
    // Signing in or up from an invitation link joins right away instead of asking again.
    if (inviteToken) {
      try { const result = await acceptInvite({ sessionToken, token: inviteToken }); setToken(sessionToken); router.replace(`/${result.slug}`); return; }
      catch (error) { setNotice(errorText(error, "Could not join")); }
    }
    setToken(sessionToken);
    if (!inviteToken && destination) router.replace(`/${destination}`);
  };
  /** Ends the session here first so the screen changes at once; `to` keeps an invitation link open for another account. */
  const signOut = async (to = "/login") => {
    if (!token) return;
    localStorage.removeItem("origin.sessionToken");
    flushSync(() => setToken(null));
    router.replace(to);
    await logout({ sessionToken: token }).catch(() => { /* The session is gone locally either way. */ });
  };
  if (!ready || (token && user === undefined)) return publicPath(path) ? <main className="public-auth" aria-busy="true" /> : <WorkspaceSkeleton />;
  if (!user || !token) {
    if (path === "/") return <Welcome />;
    return <PublicAuth key={inviteToken ?? "auth"} signup={path === "/signup" || Boolean(inviteToken)} inviteToken={inviteToken} invitation={invitation} onSession={saveSession} />;
  }
  if (inviteToken) return <AuthFrame>
    <h1>{invitation ? `Join ${invitation.name}` : invitation === undefined ? "Loading invitation" : "Invitation unavailable"}</h1>
    {invitation === null && <p>This link has expired or was revoked.</p>}
    {notice && <p className="notice danger" role="alert">{notice}</p>}
    {invitation && <JoinButton name={invitation.name} onJoin={async () => { try { const result = await acceptInvite({ sessionToken: token, token: inviteToken }); router.replace(`/${result.slug}`); } catch (error) { setNotice(errorText(error, "Could not join")); } }} />}
    {invitation === null && <Link className="primary-button large" href="/">Open Origin</Link>}
    <SignedInAs email={user.email} onSignOut={() => void signOut(path)} />
  </AuthFrame>;
  if (workspaces === undefined || redirecting) return <WorkspaceSkeleton />;
  if (!workspaces.length) return <WorkspaceOnboarding sessionToken={token} email={user.email} onSignOut={() => void signOut()} onCreated={s => router.replace(`/${s}`)} />;
  if (!workspace) return <AuthFrame>
    <h1>Workspace not found</h1>
    <nav className="workspace-choices" aria-label="Your workspaces">{workspaces.map(w => <Link className="workspace-choice" href={`/${w.slug}`} key={w._id}><span className="workspace-initial" aria-hidden="true">{w.name.slice(0, 1).toUpperCase()}</span><span>{w.name}</span><ArrowRight size={16} /></Link>)}</nav>
    {notice && <p className="notice danger">{notice}</p>}
    <SignedInAs email={user.email} onSignOut={() => void signOut()} />
  </AuthFrame>;
  return <WorkspaceContext.Provider value={workspace}><OriginWorkspace key={workspace._id} sessionToken={token} user={user} workspaces={workspaces} onLogout={() => void signOut()} /></WorkspaceContext.Provider>;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="public-auth"><Link className="origin-wordmark" href="/"><OriginMark />Origin</Link><section className="auth-content">{children}</section></main>;
}

function SignedInAs({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return <p className="auth-switch">{email} <button type="button" onClick={onSignOut}>Sign out</button></p>;
}

function PublicAuth({ signup: initialSignup, inviteToken, invitation, onSession }: { signup: boolean; inviteToken?: string; invitation?: { name: string; role: string; email?: string } | null; onSession: (token: string, slug?: string | null) => Promise<void> }) {
  const [signup, setSignup] = useState(initialSignup);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [slug, setSlug] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [host, setHost] = useState("");
  const login = useAction(api.auth.login);
  const register = useAction(api.auth.signup);
  const mode = useQuery(api.auth.signupMode, {});
  const inviteOnly = Boolean(mode?.inviteOnly) && !inviteToken;
  useEffect(() => setHost(window.location.host), []);
  useEffect(() => { if (invitation?.email) setEmail(invitation.email); }, [invitation?.email]);
  // The address follows the form, so a reload or a shared link opens the same screen.
  const switchMode = () => {
    const next = !signup;
    setSignup(next); setError(""); setVisible(false);
    if (!inviteToken) window.history.replaceState(null, "", next ? "/signup" : "/login");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (signup) { const result = await register({ email, password, name, ...(inviteToken ? { inviteToken } : { workspaceName, slug }) }); await onSession(result.sessionToken, result.slug); }
      else { const result = await login({ email, password }); await onSession(result.sessionToken); }
    } catch (error) { setError(errorText(error, "Please try again")); }
    finally { setBusy(false); }
  };
  if (inviteToken && invitation === null) return <AuthFrame>
    <h1>Invitation unavailable</h1>
    <p>This link has expired or was revoked.</p>
    <Link className="primary-button large" href="/login">Sign in</Link>
  </AuthFrame>;
  return <AuthFrame>
    <h1>{invitation ? `Join ${invitation.name}` : inviteToken ? "Join workspace" : signup ? "Create account" : "Sign in"}</h1>
    {signup && inviteOnly ? <p className="notice">Sign-up is invite-only. Ask a workspace admin for an invitation link.</p> : <form className="stack-form" onSubmit={submit}>
      {signup && <label>Your name<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} autoFocus /></label>}
      <label>Email<input autoComplete="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} required autoFocus={!signup} /></label>
      <label>Password<span className="password-input"><input autoComplete={signup ? "new-password" : "current-password"} type={visible ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={signup ? 10 : undefined} maxLength={128} placeholder={signup ? "At least 10 characters" : undefined} /><button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
      {signup && !inviteToken && <><label>Workspace name<input value={workspaceName} onChange={e => { setWorkspaceName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} required maxLength={60} /></label><label>Workspace URL<span className="slug-input"><span>{host}/</span><input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required minLength={2} maxLength={48} autoCapitalize="none" spellCheck={false} /></span></label></>}
      {error && <p role="alert" className="notice danger">{error}</p>}
      <button type="submit" className="primary-button large" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : signup ? "Create account" : "Sign in"}</button>
    </form>}{(signup || !inviteOnly) && <p className="auth-switch">{signup ? "Have an account?" : "No account?"} <button type="button" onClick={switchMode}>{signup ? "Sign in" : "Create an account"}</button></p>}
  </AuthFrame>;
}

function JoinButton({ name, onJoin }: { name: string; onJoin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <button className="primary-button large" disabled={busy} onClick={async () => { setBusy(true); try { await onJoin(); } finally { setBusy(false); } }}>{busy && <Loader2 className="spin" size={16} />}Join {name}</button>;
}

function OriginMark() {
  return <svg className="origin-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3.75" fill="currentColor" /></svg>;
}

function Welcome() {
  return <main className="public-auth welcome"><section className="auth-content"><span className="origin-wordmark"><OriginMark />Origin</span><div className="welcome-actions"><Link className="primary-button large" href="/login">Sign in</Link><Link className="ghost-button large" href="/signup">Create account</Link></div></section></main>;
}

function WorkspaceOnboarding({ sessionToken, email, onSignOut, onCreated }: { sessionToken: string; email: string; onSignOut: () => void; onCreated: (slug: string) => void }) {
  const create = useMutation(api.workspaces.create);
  const deleted = useQuery(api.workspaces.deleted, { sessionToken });
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Read once on mount: the notice is about why this screen is empty, not a live clock.
  const [shownSince] = useState(() => Date.now() - RECENT_DELETION);
  const recent = deleted?.find(notice => !notice.byYou && notice.deletedAt > shownSince);
  return <AuthFrame>
    <h1>Create a workspace</h1>
    {recent && <p className="notice">{recent.name} was deleted by {recent.deletedBy}.</p>}
    <form className="stack-form" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { const result = await create({ sessionToken, name }); onCreated(result.slug); } catch (error) { setError(errorText(error, "Could not create workspace")); setBusy(false); } }}>
      <label>Workspace name<input value={name} onChange={e => setName(e.target.value)} required maxLength={60} autoFocus /></label>
      {error && <p className="notice danger" role="alert">{error}</p>}
      <button className="primary-button large" disabled={busy || !name.trim()}>{busy ? <Loader2 className="spin" size={16} /> : "Create workspace"}</button>
    </form>
    <SignedInAs email={email} onSignOut={onSignOut} />
  </AuthFrame>;
}
