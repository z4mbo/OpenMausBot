"use client";
import { errorText } from "@/lib/error-text";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { GitBranch, Loader2, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { localApi, navigateLocalApp } from "@/lib/client-api";
import { useWorkspace } from "./workspace-context";

/** Create a private GitHub repository for the project, or connect GitHub first. Renders nothing when GitHub is not set up on the server. */
export function RepositoryProvisioning({ project, sessionToken, onStarted }: { project: Doc<"projects"> & { memberRole: string }; sessionToken: string; onStarted?: () => void }) {
  const workspace = useWorkspace();
  const github = useQuery(api.integrations.status, { sessionToken, teamId: workspace._id });
  const [connection, setConnection] = useState<{ configured: boolean; login: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = ["owner", "admin"].includes(project.memberRole);
  useEffect(() => { let disposed = false; localApi<{ configured: boolean; login: string | null }>(`/api/github/workspace?teamId=${workspace._id}`, sessionToken).then(value => { if (!disposed) setConnection(value); }).catch(() => { if (!disposed) setError("Could not check the GitHub connection"); }); return () => { disposed = true; }; }, [sessionToken, workspace._id]);
  const connected = Boolean(connection?.login && github?.login && connection.login === github.login);
  const connect = async () => {
    setBusy(true); setError("");
    try {
      const result = await localApi<{ url: string }>(`/api/github/oauth/start?teamId=${workspace._id}&projectId=${project._id}`, sessionToken, { method: "POST" });
      navigateLocalApp(result.url); setBusy(false);
    } catch (error) { setError(errorText(error, "Could not connect GitHub")); setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError("");
    try {
      const result = await localApi<{ state: string; error?: string }>(`/api/github/repo?teamId=${workspace._id}&projectId=${project._id}`, sessionToken, { method: "POST" });
      if (result.state === "awaiting_connection") throw new Error("Reconnect GitHub to this workspace first");
      onStarted?.();
    } catch (error) { setError(errorText(error, "Could not create repository")); }
    finally { setBusy(false); }
  };
  if (!admin || (!error && !connection?.configured)) return null;
  return <div className="repo-provisioning">
    {connected
      ? <button type="button" className="ghost-button compact" disabled={busy || project.githubRepoState === "pending"} onClick={create}>{busy ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}Create private repository on @{github?.login}</button>
      : connection?.configured && <button type="button" className="ghost-button compact" disabled={busy} onClick={connect}>{busy ? <Loader2 className="spin" size={14} /> : <GitBranch size={14} />}Connect GitHub</button>}
    {error && <p className="notice danger" role="alert">{error}</p>}
  </div>;
}
