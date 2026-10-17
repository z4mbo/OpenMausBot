"use client";
import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { localApi } from "@/lib/client-api";

export default function Authorize() {
  const [session, setSession] = useState(""); const [query, setQuery] = useState("");
  const [app, setApp] = useState<{ name: string; domain: string; write: boolean } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [teamId, setTeamId] = useState("");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const login = useAction(api.auth.login);
  const me = useQuery(api.auth.me, session ? { sessionToken: session } : "skip");
  const workspaces = useQuery(api.workspaces.list, me ? { sessionToken: session } : "skip");
  useEffect(() => {
    const params = window.location.search.slice(1); setQuery(params); setSession(localStorage.getItem("origin.sessionToken") || "");
    fetch(`/api/mcp/authorize?${params}`).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error); setApp(body); }).catch(e => setError(e.message));
  }, []);
  const consent = async (allow: boolean) => { setBusy(true); setError(""); try { const result = await localApi<{ url: string }>("/api/mcp/authorize", session, { method: "POST", json: { query, teamId: teamId || workspaces?.[0]?._id, allow } }); window.location.assign(result.url); } catch (e) { setError(e instanceof Error ? e.message : "Authorization failed"); setBusy(false); } };
  return <main className="connector-consent"><a className="consent-brand" href="/">Origin</a><section><ShieldCheck size={26} /><h1>{app ? `Connect ${app.name}` : "Connect to Origin"}</h1>{app && <p className="consent-domain">{app.domain}</p>}
    {app && (!session || me === null) ? <form className="stack-form" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { const result = await login({ email, password }); setSession(result.sessionToken); localStorage.setItem("origin.sessionToken", result.sessionToken); setPassword(""); } catch { setError("Invalid email or password"); } finally { setBusy(false); } }}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="primary-button" disabled={busy}>Sign in</button></form>
      : app && me && workspaces ? <><p className="consent-account">{me.email}</p><label className="consent-workspace">Workspace<select value={teamId || workspaces[0]?._id || ""} onChange={e => setTeamId(e.target.value)}>{workspaces.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}</select></label><ul><li>Read projects, issues, and member names</li>{app.write && <li>Create and modify projects and issues</li>}<li>No access to vault secrets, chat, or GitHub tokens</li></ul><p className="consent-expiry">Access expires in 90 days. Revoke anytime in Settings.</p><div className="row gap"><button className="ghost-button" disabled={busy} onClick={() => consent(false)}>Cancel</button><button className="primary-button" disabled={busy || !workspaces.length} onClick={() => consent(true)}>{busy ? <Loader2 className="spin" size={16} /> : null}Allow access</button></div></> : !error && <Loader2 className="spin" size={20} />}
    {error && <p className="notice danger" role="alert">{error}</p>}
  </section></main>;
}
