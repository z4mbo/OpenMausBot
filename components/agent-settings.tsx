"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, KeyRound, Loader2, Plug, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "./workspace-context";
import { localAppOrigin } from "@/lib/client-api";
import { errorText } from "@/lib/error-text";
import "./agent-settings.css";

const CLIENTS = ["Claude Code", "Codex", "OpenCode", "omp", "T3 Code", "ChatGPT"] as const;
type Client = typeof CLIENTS[number];

/** Copy-paste setup per client. With a token the snippet sends it as a header; without one the client signs in with OAuth. */
export function clientSetup(client: Client, url: string, token?: string): { file?: string; code?: string; note?: string } {
  const bearer = `Bearer ${token}`;
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  switch (client) {
    case "Claude Code": return token
      ? { code: `claude mcp add --transport http origin ${url} --header "Authorization: ${bearer}"` }
      : { code: `claude mcp add --transport http origin ${url}`, note: "Then run /mcp in Claude Code to sign in." };
    case "Codex": return token
      ? { file: "~/.codex/config.toml", code: `[mcp_servers.origin]\nurl = "${url}"\nhttp_headers = { "Authorization" = "${bearer}" }` }
      : { code: `codex mcp add origin --url ${url}\ncodex mcp login origin` };
    case "OpenCode": return { file: "opencode.json", code: json({ $schema: "https://opencode.ai/config.json", mcp: { origin: { type: "remote", url, ...(token ? { headers: { Authorization: bearer } } : {}) } } }), ...(token ? {} : { note: "Then run opencode mcp auth origin." }) };
    case "omp": return { file: "~/.omp/agent/mcp.json", code: json({ mcpServers: { origin: { type: "http", url, ...(token ? { headers: { Authorization: bearer } } : {}) } } }) };
    case "T3 Code": return { note: "T3 Code uses your Codex, Claude Code or OpenCode setup." };
    case "ChatGPT": return { note: "Settings → Apps → Advanced settings → Developer mode → Create app. Paste the URL and choose OAuth. Needs a public HTTPS address." };
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard unavailable */ } }}>{done ? <Check size={15} /> : <Copy size={15} />}</button>;
}

export function AgentSettings({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const grants = useQuery(api.connectors.listGrants, { sessionToken, teamId: workspace._id });
  const createToken = useMutation(api.mcp.createToken), revoke = useMutation(api.connectors.revoke);
  const canWrite = workspace.role !== "viewer";
  const [client, setClient] = useState<Client>("Claude Code");
  const [name, setName] = useState(""), [write, setWrite] = useState(canWrite), [days, setDays] = useState(90);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [now] = useState(() => Date.now());
  const url = typeof window === "undefined" ? "" : `${localAppOrigin()}/api/mcp`;
  const setup = clientSetup(client, url, created?.token);
  const active = grants?.filter(g => !g.revoked && g.expiresAt > now);
  const attempt = async (fn: () => Promise<void>) => { setBusy(true); setNotice(""); try { await fn(); } catch (e) { setNotice(errorText(e, "Something went wrong")); } finally { setBusy(false); } };
  const submit = (event: FormEvent) => { event.preventDefault(); void attempt(async () => { const result = await createToken({ sessionToken, teamId: workspace._id, name: name.trim(), write: write && canWrite, days }); setCreated({ token: result.token, name: name.trim() }); setName(""); }); };

  return <div className="agent-settings">
    <h3>Agents</h3>
    <div className="agent-url"><Plug size={15} /><input aria-label="MCP server URL" value={url} readOnly onFocus={e => e.currentTarget.select()} /><CopyButton value={url} label="Copy MCP URL" /></div>

    <div className="agent-clients" role="tablist" aria-label="Client">{CLIENTS.map(item => <button key={item} type="button" role="tab" aria-selected={client === item} className={client === item ? "active" : ""} onClick={() => setClient(item)}>{item}</button>)}</div>
    <div className="agent-setup" role="tabpanel">
      {setup.file && <small className="agent-file">{setup.file}</small>}
      {setup.code && <div className="agent-snippet"><pre><code>{setup.code}</code></pre><CopyButton value={setup.code} label={`Copy ${client} setup`} /></div>}
      {setup.note && <p>{setup.note}</p>}
    </div>

    <div className="settings-section">
      <h4>Access tokens</h4>
      <form className="agent-token-form" onSubmit={submit}>
        <input aria-label="Token name" placeholder="Name" value={name} maxLength={60} required onChange={e => setName(e.target.value)} />
        <select aria-label="Access" value={write && canWrite ? "write" : "read"} disabled={!canWrite} onChange={e => setWrite(e.target.value === "write")}><option value="write">Read & write</option><option value="read">Read only</option></select>
        <select aria-label="Expires" value={days} onChange={e => setDays(Number(e.target.value))}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select>
        <button className="primary-button compact" disabled={busy || !name.trim()}>{busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}Create</button>
      </form>
      {created && <div className="agent-new-token"><input aria-label={`Token ${created.name}`} value={created.token} readOnly onFocus={e => e.currentTarget.select()} /><CopyButton value={created.token} label="Copy token" /><small>Shown once. The setup above now includes it.</small></div>}
      {notice && <p className="notice danger" role="alert">{notice}</p>}
    </div>

    <div className="settings-section">
      <h4>Connected</h4>
      <div className="connector-grants">
        {active?.map(g => <div className="connector-grant" key={g._id}><div><strong>{g.name}</strong><small>{g.write ? "Read & write" : "Read only"} · Expires {new Date(g.expiresAt).toLocaleDateString()}</small></div><button className="icon-button" title={`Revoke ${g.name}`} aria-label={`Revoke ${g.name}`} disabled={busy} onClick={() => attempt(async () => { await revoke({ sessionToken, teamId: workspace._id, grantId: g._id }); })}><Trash2 size={15} /></button></div>)}
        {active && !active.length && <p className="muted">None</p>}
      </div>
    </div>
  </div>;
}
