import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { cloudAction, useCloudQuery } from "@/lib/origin-cloud";
import type { CloudProject } from "./cloud-types";
import { Notice, ghostButton, useAction } from "./ui";

type Protection = { state: "on" | "unavailable" | "error"; branch: string; detail?: string; checkedAt: number } | null;

/** Offers a project admin GitHub branch protection for a repository Origin did not create with it. */
export function BranchProtectionNotice({ project, projectId, isAdmin }: { project: CloudProject; projectId: string; isAdmin: boolean }) {
  const status = useCloudQuery<Protection>("githubProtection:status", project.githubWorkspaceAccess ? { projectId } : "skip");
  const [answer, setAnswer] = useState<Protection>(null);
  const action = useAction();
  const current = answer ?? status;
  if (!project.githubWorkspaceAccess || status === undefined || current?.state === "on") return null;
  if (!isAdmin) return current ? <Notice>{current.detail ?? "The default branch is not protected yet."}</Notice> : null;
  const protect = () => action.run(async () => {
    const result = await cloudAction<NonNullable<Protection>>("githubProtection:protect", { projectId });
    setAnswer({ ...result, checkedAt: Date.now() });
  }, "Could not protect the default branch");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Notice tone={current?.state === "error" ? "danger" : undefined}>
        {current?.detail ?? "The default branch is not protected: the push token agents use could change it without a reviewed pull request. Protect it so every change goes through a pull request someone approves."}
      </Notice>
      <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void protect()}><ShieldCheck size={14} />Protect default branch</button>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </div>
  );
}
