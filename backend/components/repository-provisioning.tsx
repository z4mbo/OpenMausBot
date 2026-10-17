"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { GitBranch, Loader2, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { localApi, navigateLocalApp } from "@/lib/client-api";
import { useWorkspace } from "./workspace-context";

export function RepositoryProvisioning({ project, sessionToken }: { project: Doc<"projects"> & { memberRole: string }; sessionToken: string }) {
  const workspace = useWorkspace();
  const github = useQuery(api.integrations.status, { sessionToken, teamId: workspace._id });
  const [connection, setConnection] = useState<{ configured: boolean; login: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const admin = ["owner", "admin"].includes(project.memberRole);
  useEffect(() => { let disposed = false; localApi<{ configured: boolean; login: string | null }>(`/api/github/workspace?teamId=${workspace._id}`, sessionToken).then(value => { if (!disposed) setConnection(value); }).catch(() => { if (!disposed) setError("Could not check GitHub connection. Reload and try again."); }); return () => { disposed = true; }; }, [sessionToken, workspace._id]);
  const connected = Boolean(connection?.login && github?.login && connection.login === github.login);
  const connect = async () => {
    setBusy(true); setError("");
    try {
      const result = await localApi<{ url: string }>(`/api/github/oauth/start?teamId=${workspace._id}&projectId=${project._id}`, sessionToken, { method: "POST" });
      navigateLocalApp(result.url); setBusy(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not connect GitHub"); setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await localApi<{ state: string; error?: string }>(`/api/github/repo?teamId=${workspace._id}&projectId=${project._id}`, sessionToken, { method: "POST" });
      if (result.state === "awaiting_connection") throw new Error("Reconnect GitHub to this workspace before creating a repository.");
      setNotice(result.state === "working" ? "Repository creation is already running. This view updates automatically." : "Private repository created.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create repository"); }
    finally { setBusy(false); }
  };
  return <div className="repo-connection-state"><GitBranch size={22} /><p>{connected ? project.githubRepoState === "pending" ? "Creating your private repository..." : `Create a private repository on @${github?.login}.` : connection?.configured ? "Connect your GitHub account to this workspace to create a repository." : connection ? "A server administrator needs to configure the GitHub integration." : "Checking GitHub connection..."}</p>{admin && <div className="integration-actions">{connected ? <button className="primary-button compact" disabled={busy} onClick={create}>{busy ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}Create private repository</button> : connection?.configured && <button className="primary-button compact" disabled={busy} onClick={connect}>{busy ? <Loader2 className="spin" size={14} /> : <GitBranch size={14} />}Connect GitHub</button>}{connected && <button className="ghost-button compact" disabled={busy} onClick={connect}>Reconnect GitHub</button>}</div>}{!admin && <p className="muted">Ask a workspace admin to connect GitHub.</p>}{(error || project.githubRepoError) && <p className="notice danger" role="alert">{error || project.githubRepoError}</p>}{notice && <p className="notice" role="status">{notice}</p>}</div>;
}
