"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, ExternalLink, GitBranch, Loader2, Plug, Unplug } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "./workspace-context";
import { localApi, localAppOrigin, navigateLocalApp } from "@/lib/client-api";

type Config = { configured: boolean; canSetup: boolean; login: string | null; installationUrl: string | null; prPermissionNotice?: string; permissionApprovalUrl?: string };
export function IntegrationSettings({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const [config, setConfig] = useState<Config | null>(null), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const github = useQuery(api.integrations.status, { sessionToken, teamId: workspace._id });
  const grants = useQuery(api.connectors.listGrants, { sessionToken, teamId: workspace._id });
  const configure = useMutation(api.integrations.configure), revoke = useMutation(api.connectors.revoke);
  const admin = ["owner", "admin"].includes(workspace.role);
  const endpoint = typeof window === "undefined" ? "" : `${localAppOrigin()}/api/mcp`;
  const reload = () => localApi<Config>(`/api/github/workspace?teamId=${workspace._id}`, sessionToken).then(setConfig);
  useEffect(() => { void reload().catch(() => setNotice("Could not load GitHub connection")); }, [sessionToken, workspace._id]);
  const attempt = async (fn: () => Promise<void>) => { setBusy(true); setNotice(""); try { await fn(); } catch (e) { setNotice(e instanceof Error ? e.message : "Could not update connection"); } finally { setBusy(false); } };
  const connect = () => attempt(async () => { const result = await localApi<{ url: string }>(`/api/github/oauth/start?teamId=${workspace._id}`, sessionToken, { method: "POST" }); navigateLocalApp(result.url); });
  const setup = () => attempt(async () => {
    const result = await localApi<{ action: string; manifest: unknown }>(`/api/github/setup?teamId=${workspace._id}`, sessionToken, { method: "POST" });
    const form = document.createElement("form"); form.method = "POST"; form.action = result.action;
    if (localAppOrigin() !== window.location.origin) { form.target = "_blank"; form.rel = "noopener noreferrer"; }
    const field = document.createElement("input"); field.type = "hidden"; field.name = "manifest"; field.value = JSON.stringify(result.manifest);
    form.append(field); document.body.append(form); form.submit(); form.remove();
  });
  return <div className="integrations-settings">
    <section className="integration-section"><div className="integration-heading"><GitBranch size={20} /><div><strong>GitHub</strong><span>{github?.login ? `Connected as @${github.login}` : "Not connected"}</span></div>{busy && <Loader2 size={16} className="spin" />}</div>
      {admin && config && <div className="integration-actions">{config.configured ? <button className="primary-button compact" disabled={busy} onClick={connect}><GitBranch size={14} />{github?.login ? "Reconnect" : "Connect GitHub"}</button> : config.canSetup ? <button className="primary-button compact" disabled={busy} onClick={setup}><GitBranch size={14} />Set up Origin GitHub App</button> : <p className="muted">GitHub is not available yet.</p>}
      {github?.login && <button className="ghost-button compact" disabled={busy} onClick={() => { if (window.confirm("Disconnect GitHub for this workspace? Existing repositories will not be deleted.")) void attempt(async () => { await localApi(`/api/github/workspace?teamId=${workspace._id}`, sessionToken, { method: "DELETE" }); await reload(); }); }}><Unplug size={14} />Disconnect</button>}
      {config.installationUrl && <a className="ghost-button compact" href={config.installationUrl} target="_blank" rel="noreferrer">Repository access<ExternalLink size={13} /></a>}</div>}
      <label className="integration-toggle"><input type="checkbox" disabled={!admin || !github?.login || busy} checked={Boolean(github?.autoCreate)} onChange={e => attempt(async () => { await configure({ sessionToken, teamId: workspace._id, autoCreate: e.target.checked }); })} /><span>Create a private repository for new projects</span></label>
      {admin && config?.prPermissionNotice && <div className="notice" role="status"><p>{config.prPermissionNotice}</p><a className="ghost-button compact" href={config.permissionApprovalUrl} target="_blank" rel="noreferrer">Re-approve permissions<ExternalLink size={13} /></a></div>}
    </section>
    <section className="integration-section"><div className="integration-heading"><Plug size={20} /><div><strong>ChatGPT & Claude</strong><span>MCP connection</span></div></div><div className="integration-endpoint"><input aria-label="MCP server URL" value={endpoint} readOnly /><button className="icon-button" aria-label="Copy MCP server URL" title="Copy MCP server URL" onClick={() => attempt(async () => { await navigator.clipboard.writeText(endpoint); setCopied(true); setTimeout(() => setCopied(false), 2000); })}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
      <div className="connector-grants">{grants?.filter(g => !g.revoked && g.expiresAt > Date.now()).map(g => <div className="connector-grant" key={g._id}><div><strong>{g.name}</strong><small>{g.write ? "Read & write" : "Read only"} / Expires {new Date(g.expiresAt).toLocaleDateString()}</small></div><button className="icon-button" title={`Disconnect ${g.name}`} aria-label={`Disconnect ${g.name}`} disabled={busy} onClick={() => attempt(async () => { await revoke({ sessionToken, teamId: workspace._id, grantId: g._id }); })}><Unplug size={16} /></button></div>)}{grants && !grants.some(g => !g.revoked && g.expiresAt > Date.now()) && <p className="muted">No connected apps</p>}</div>
    </section>
    {notice && <p className="notice danger" role="alert">{notice}</p>}
  </div>;
}
