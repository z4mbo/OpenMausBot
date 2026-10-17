"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { GitBranch, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { localApi, navigateLocalApp } from "@/lib/client-api";
import { useWorkspace } from "./workspace-context";
import { Dialog } from "./dialog";
import { ProjectPRSettings } from "./project-pr-settings";

export function WorkspaceGitHubSetup({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const connection = useQuery(api.integrations.status, { sessionToken, teamId: workspace._id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = ["owner", "admin"].includes(workspace.role);
  return <div className="repo-workspace-setup"><div><GitBranch size={16} /><span>{connection === undefined ? "Checking GitHub..." : connection.login ? `Workspace GitHub: @${connection.login}` : "Workspace GitHub is not connected"}</span></div>{admin ? <button type="button" className="ghost-button compact" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const { url } = await localApi<{ url: string }>(`/api/github/oauth/start?teamId=${workspace._id}`, sessionToken, { method: "POST" }); navigateLocalApp(url); setBusy(false); } catch (error) { setError(error instanceof Error ? error.message : "Could not connect GitHub"); setBusy(false); } }}>{busy ? <Loader2 size={14} className="spin" /> : <GitBranch size={14} />}{connection?.login ? "Reconnect GitHub" : "Connect GitHub"}</button> : !connection?.login && <p className="muted">A workspace admin needs to connect GitHub.</p>}{error && <p className="notice danger" role="alert">{error}</p>}</div>;
}

export function RepositorySettings({ project, sessionToken, onClose, onSaved }: { project: Doc<"projects">; sessionToken: string; onClose: () => void; onSaved: () => void }) {
  const workspace = useWorkspace();
  const update = useMutation(api.projects.update);
  const approve = useMutation(api.integrations.approveRepository);
  const [url, setUrl] = useState(project.repoUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = ["owner", "admin"].includes(workspace.role);
  return <Dialog title="Repository settings" onClose={onClose}><div className="dialog-body"><form className="stack-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await update({ sessionToken, projectId: project._id, repoUrl: url }); onSaved(); onClose(); } catch (error) { setError(error instanceof Error ? error.message : "Could not update repository"); } finally { setBusy(false); } }}><label>Repository URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" autoFocus required /></label><button className="primary-button compact" disabled={busy}>Save repository</button></form><ProjectPRSettings project={project} sessionToken={sessionToken} /><WorkspaceGitHubSetup sessionToken={sessionToken} />{admin && project.repoUrl && !project.githubWorkspaceAccess && <button type="button" className="ghost-button compact" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await approve({ sessionToken, projectId: project._id, repoUrl: project.repoUrl }); onSaved(); onClose(); } catch (error) { setError(error instanceof Error ? error.message : "Could not authorize repository"); } finally { setBusy(false); } }}><GitBranch size={14} />Authorize workspace access</button>}{error && <p className="notice danger" role="alert">{error}</p>}</div></Dialog>;
}
