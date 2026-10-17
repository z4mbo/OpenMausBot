"use client";

import { useEffect, useState } from "react";
import { GitBranch, ExternalLink, Loader2, Unplug } from "lucide-react";
import { localApi } from "@/lib/client-api";
import { Dialog } from "./dialog";

type Connection = { login: string; updatedAt?: number; source?: "project" | "workspace" } | null;
export function GitHubConnection({ projectId, repoUrl, sessionToken, canManage, onChange }: { projectId: string; repoUrl?: string; sessionToken: string; canManage: boolean; onChange: () => void }) {
  const [connection, setConnection] = useState<Connection>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const endpoint = `/api/github/connection?projectId=${projectId}`;
  useEffect(() => { let active = true; localApi<{ connection: Connection }>(endpoint, sessionToken).then(result => { if (active) setConnection(result.connection); }).catch(() => { if (active) setNotice("Could not load the GitHub connection."); }); return () => { active = false; }; }, [endpoint, repoUrl, sessionToken]);
  const close = () => { setOpen(false); setToken(""); setNotice(""); };
  const disconnect = async () => {
    if (!window.confirm("Disconnect GitHub for this project? Other project members will lose private repository access through Origin.")) return;
    setBusy(true);
    try { await localApi(endpoint, sessionToken, { method: "DELETE" }); setConnection(null); onChange(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not disconnect"); }
    finally { setBusy(false); }
  };
  return <div className="github-connection">
    <div className="github-connection-status"><GitBranch size={16} /><span>{connection ? `Connected as @${connection.login}${connection.source === "workspace" ? " via workspace" : ""}` : repoUrl ? "No repository connection" : "No repository linked"}</span>{canManage && connection && connection.source !== "workspace" && <button className="icon-button" disabled={busy} title="Disconnect GitHub" aria-label="Disconnect GitHub" onClick={disconnect}><Unplug size={15} /></button>}</div>
    {canManage && repoUrl ? <button className="ghost-button compact" disabled={busy} onClick={() => { setNotice(""); setOpen(true); }}>{connection ? "Use a project token" : "Connect with a token"}</button> : !canManage && !connection && repoUrl && <p className="muted">Ask a project admin to connect GitHub for private repository access.</p>}
    {notice && !open && <p className="notice danger" role="alert">{notice}</p>}
    {open && <Dialog title="Connect GitHub" onClose={close}><form className="dialog-body stack-form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setNotice("");
      try { const result = await localApi<{ connection: Connection }>(endpoint, sessionToken, { method: "POST", json: { token: token.trim() } }); setConnection(result.connection); close(); onChange(); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect GitHub"); }
      finally { setBusy(false); }
    }}>
      <p className="muted">Select this repository in a fine-grained access token. Allow Contents: read, Pull requests: read, and Issues: read and write.</p>
      <a className="ghost-button compact" href="https://github.com/settings/personal-access-tokens/new?name=Origin&contents=read&issues=write&pull_requests=read" target="_blank" rel="noreferrer">Create a token on GitHub<ExternalLink size={14} /></a>
      <label>GitHub access token<input type="password" name="github-token" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" spellCheck={false} required maxLength={500} placeholder="github_pat_..." /></label>
      <p className="muted">This connection is shared with project members. Editors can create GitHub issues using your account. Your token is encrypted and never displayed to members.</p>
      {notice && <p className="notice danger" role="alert">{notice}</p>}
      <div className="row gap"><button className="primary-button compact" disabled={busy}>{busy && <Loader2 size={14} className="spin" />}{busy ? "Connecting..." : "Connect repository"}</button><button type="button" className="ghost-button compact" onClick={close}>Cancel</button></div>
    </form></Dialog>}
  </div>;
}
