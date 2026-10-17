"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Eye, EyeOff, Loader2, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { WorkspaceContext } from "./workspace-context";
import { HomePage, customHomePage } from "./home-page";
import { WorkspaceSkeleton } from "./content-skeleton";

const OriginWorkspace = dynamic(() => import("./origin-app").then(module => module.OriginWorkspace), {
  loading: () => <WorkspaceSkeleton />,
});

export function OriginEntry() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const path = usePathname();
  const router = useRouter();
  const user = useQuery(api.auth.me, token ? { sessionToken: token } : "skip");
  const workspaces = useQuery(api.workspaces.list, token && user ? { sessionToken: token } : "skip");
  const ensureLegacy = useMutation(api.workspaces.ensureLegacyWorkspace);
  const acceptInvite = useMutation(api.workspaces.acceptInvite);
  const logout = useMutation(api.auth.logout);
  const inviteToken = path.startsWith("/join/") ? path.split("/")[2] : undefined;
  const invitation = useQuery(api.workspaces.invitePreview, inviteToken ? { token: inviteToken } : "skip");
  const slug = path.split("/")[1];
  const workspace = workspaces?.find(w => w.slug === slug);
  useEffect(() => { setToken(localStorage.getItem("origin.sessionToken")); setReady(true); }, []);
  useEffect(() => {
    if (token && user) void ensureLegacy({ sessionToken: token }).catch(error => setNotice(error.message));
  }, [token, user?._id, ensureLegacy]);
  useEffect(() => {
    if (!token || !user || !workspaces?.length || inviteToken) return;
    if (["", "login", "signup"].includes(slug)) {
      const preferred = workspaces.find(w => w.slug === localStorage.getItem("origin.workspace")) || workspaces[0];
      router.replace(`/${preferred.slug}`);
    }
  }, [token, user, workspaces, inviteToken, slug, router]);
  const saveSession = (sessionToken: string, destination?: string | null) => {
    localStorage.setItem("origin.sessionToken", sessionToken); setToken(sessionToken);
    if (!inviteToken && destination) router.replace(`/${destination}`);
  };
  if (!ready && path === "/" && customHomePage) return <HomePage />;
  if (!ready || (token && user === undefined)) return <WorkspaceSkeleton />;
  if (!user || !token) {
    if (path === "/" && customHomePage) return <HomePage />;
    return <PublicAuth signup={path === "/signup"} inviteToken={inviteToken} invitation={invitation} onSession={saveSession} />;
  }
  if (inviteToken) return <main className="public-auth"><Link className="origin-wordmark" href="/">Origin</Link><section className="auth-content"><Users size={28} /><h1>{invitation ? `Join ${invitation.name}` : invitation === undefined ? "Loading invitation" : "Invitation unavailable"}</h1><p className="muted">{invitation ? `Signed in as ${user.email}` : "This link may have expired or been revoked."}</p>{notice && <p className="notice danger">{notice}</p>}{invitation && <button className="primary-button" onClick={async () => { try { const result = await acceptInvite({ sessionToken: token, token: inviteToken }); router.replace(`/${result.slug}`); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not join"); } }}>Join workspace <ArrowRight size={16} /></button>}<Link href="/">Back to Origin</Link></section></main>;
  if (workspaces === undefined) return <WorkspaceSkeleton />;
  if (!workspaces.length) return <WorkspaceOnboarding sessionToken={token} onCreated={s => router.replace(`/${s}`)} />;
  if (!workspace) return <main className="public-auth"><section className="auth-content"><h1>Your workspaces</h1>{workspaces.map(w => <Link className="workspace-choice" href={`/${w.slug}`} key={w._id}><span>{w.name}</span><ArrowRight size={16} /></Link>)}{notice && <p className="notice danger">{notice}</p>}</section></main>;
  return <WorkspaceContext.Provider value={workspace}><OriginWorkspace key={workspace._id} sessionToken={token} user={user} workspaces={workspaces} onLogout={async () => { await logout({ sessionToken: token }); localStorage.removeItem("origin.sessionToken"); setToken(null); router.replace("/login"); }} /></WorkspaceContext.Provider>;
}

function PublicAuth({ signup: initialSignup, inviteToken, invitation, onSession }: { signup: boolean; inviteToken?: string; invitation?: { name: string; role: string; email?: string } | null; onSession: (token: string, slug?: string | null) => void }) {
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
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (signup) { const result = await register({ email, password, name, ...(inviteToken ? { inviteToken } : { workspaceName, slug }) }); onSession(result.sessionToken, result.slug); }
      else { const result = await login({ email, password }); onSession(result.sessionToken); }
    } catch (error) { setError(error instanceof Error ? error.message.replace(/\[CONVEX[^\]]*\]\s*/g, "").replace(/Uncaught Error: /g, "") : "Please try again"); }
    finally { setBusy(false); }
  };
  return <main className="public-auth"><nav><Link className="origin-wordmark" href="/">Origin</Link>{customHomePage && <Link href="/">Back to home</Link>}</nav><section className="auth-content">
    
    <h1>{invitation ? `Join ${invitation.name}` : signup ? "Make room for your next idea." : "Welcome back."}</h1>
    <p className="muted">{signup ? "Create your account and bring your team together." : "Sign in to your workspace."}</p>
    {signup && inviteOnly ? <p className="notice">This Origin instance is invite-only. Ask a workspace admin for an invitation link.</p> : <form className="stack-form" onSubmit={submit}>
      {signup && <label>Your name<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} placeholder="Alex Smith" /></label>}
      <label>Email<input autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" /></label>
      <label>Password<span className="password-input"><input autoComplete={signup ? "new-password" : "current-password"} type={visible ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={signup ? 10 : undefined} maxLength={128} placeholder={signup ? "At least 10 characters" : "Your password"} /><button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
      {signup && !inviteToken && <><label>Workspace name<input value={workspaceName} onChange={e => { setWorkspaceName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} required placeholder="Your team" maxLength={60} /></label><label>Workspace URL<span className="slug-input"><span>{host}/</span><input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required minLength={2} maxLength={48} /></span></label></>}
      {error && <p role="alert" className="notice danger">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <>{signup ? "Create account" : "Sign in"}<ArrowRight size={16} /></>}</button>
    </form>}{(signup || !inviteOnly) && <p className="auth-switch">{signup ? "Already have an account?" : "New to Origin?"} <button onClick={() => { setSignup(!signup); setError(""); }}>{signup ? "Sign in" : "Create an account"}</button></p>}
  </section><footer>Origin. A space to make things happen.</footer></main>;
}

export function WorkspaceOnboarding({ sessionToken, onCreated }: { sessionToken: string; onCreated: (slug: string) => void }) {
  const create = useMutation(api.workspaces.create);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="public-auth"><section className="auth-content"><Users size={28} /><h1>Create your workspace</h1><form className="stack-form" onSubmit={async e => { e.preventDefault(); setBusy(true); try { const result = await create({ sessionToken, name }); onCreated(result.slug); } catch (error) { setError(error instanceof Error ? error.message : "Could not create workspace"); } finally { setBusy(false); } }}><label>Workspace name<input value={name} onChange={e => setName(e.target.value)} required maxLength={60} /></label>{error && <p className="notice danger">{error}</p>}<button className="primary-button" disabled={busy}>Create workspace<ArrowRight size={16} /></button></form></section></main>;
}
