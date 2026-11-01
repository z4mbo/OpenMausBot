"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2, Plug } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { localApi } from "@/lib/client-api";

type Request = { name: string; domain: string; write: boolean };

export default function Authorize() {
  const [session, setSession] = useState(""), [query, setQuery] = useState("");
  const [app, setApp] = useState<Request | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [teamId, setTeamId] = useState(""), [write, setWrite] = useState(true);
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const login = useAction(api.auth.login);
  const me = useQuery(api.auth.me, session ? { sessionToken: session } : "skip");
  const workspaces = useQuery(api.workspaces.list, me ? { sessionToken: session } : "skip");
  useEffect(() => {
    const params = window.location.search.slice(1); setQuery(params);
    try { setSession(localStorage.getItem("origin.sessionToken") || ""); } catch { /* storage unavailable */ }
    fetch(`/api/oauth/consent?${params}`).then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error); setApp(body);
    }).catch(e => setError(e.message));
  }, []);
  const selected = workspaces?.find(w => w._id === teamId) ?? workspaces?.[0];
  const canWrite = Boolean(app?.write && selected && selected.role !== "viewer");
  const consent = async (allow: boolean) => {
    setBusy(true); setError("");
    try { const result = await localApi<{ url: string }>("/api/oauth/consent", session, { method: "POST", json: { query, teamId: selected?._id, allow, write: canWrite && write } }); window.location.assign(result.url); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect"); setBusy(false); }
  };
  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await login({ email, password }); setSession(result.sessionToken); try { localStorage.setItem("origin.sessionToken", result.sessionToken); } catch { /* storage unavailable */ } setPassword(""); }
    catch { setError("Invalid email or password"); } finally { setBusy(false); }
  };
  return <main className="connector-consent"><a className="consent-brand" href="/">Origin</a><section><Plug size={24} /><h1>{app ? `Connect ${app.name}` : "Connect to Origin"}</h1>{app && <p className="consent-domain">{app.domain}</p>}
    {app && (!session || me === null) ? <form className="stack-form consent-form" onSubmit={signIn}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="primary-button" disabled={busy}>Sign in</button></form>
      : app && me && workspaces ? <>
        <p className="consent-account">{me.email}</p>
        {workspaces.length ? <label className="consent-workspace">Workspace<select value={selected?._id ?? ""} onChange={e => setTeamId(e.target.value)}>{workspaces.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}</select></label> : <p className="notice">Join a workspace first.</p>}
        {app.write && <label className="consent-write"><input type="checkbox" checked={canWrite && write} disabled={!canWrite} onChange={e => setWrite(e.target.checked)} /><span>Allow changes</span></label>}
        <p className="consent-expiry">Acts as you. Expires in 90 days.</p>
        <div className="row gap"><button className="ghost-button" disabled={busy} onClick={() => consent(false)}>Cancel</button><button className="primary-button" disabled={busy || !selected} onClick={() => consent(true)}>{busy && <Loader2 className="spin" size={16} />}Allow</button></div>
      </> : !error && <Loader2 className="spin" size={20} />}
    {error && <p className="notice danger" role="alert">{error}</p>}
  </section></main>;
}
