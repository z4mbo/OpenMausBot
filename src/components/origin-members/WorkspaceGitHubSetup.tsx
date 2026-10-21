import { useEffect, useState } from "react";
import { Github } from "lucide-react";
import { closeWorkspaceGitHubOffer, markWorkspaceGitHubIntroSeen, useWorkspaceGitHubOffer, workspaceGitHubIntroSeen } from "@/lib/origin-cloud/workspace-setup";
import { originGitHub, type GitHubWorkspaceStatus } from "@/lib/origin-github";
import { useWorkspaceAccess } from "@/lib/origin-members";
import { useActiveOriginWorkspace } from "@/lib/use-origin-workspace";
import { CenteredDialog } from "../CenteredDialog";
import { ghostButton, primaryButton } from "../origin-pages/ui";
import { WorkspaceGitHubCard } from "./WorkspaceGitHubCard";

type Step = { teamId: string; owner: true } | { teamId: string; owner: false; sharedByName: string };

/**
 * The first-run GitHub step: an owner who just created a workspace may connect and share GitHub or skip it, and a
 * member who opens a workspace whose GitHub is shared is told once that they can use it.
 */
export function WorkspaceGitHubSetup() {
  const offered = useWorkspaceGitHubOffer();
  const { teamId } = useActiveOriginWorkspace();
  const access = useWorkspaceAccess(teamId);
  const [intro, setIntro] = useState<Step | null>(null);
  const manager = access?.role === "owner" || access?.role === "admin";
  useEffect(() => {
    if (!teamId || !access || manager || offered || workspaceGitHubIntroSeen(teamId)) return;
    let live = true;
    originGitHub.workspace(teamId).then((status) => {
      if (!live || !status.shared) return;
      markWorkspaceGitHubIntroSeen(teamId);
      setIntro({ teamId, owner: false, sharedByName: status.shared.sharedByName });
    }, () => undefined);
    return () => { live = false; };
  }, [teamId, access, manager, offered]);
  const step: Step | null = offered ? { teamId: offered, owner: true } : intro;
  if (!step) return null;
  const close = () => { if (step.owner) closeWorkspaceGitHubOffer(); else setIntro(null); };
  return <SetupDialog key={step.teamId} step={step} onClose={close} />;
}

function SetupDialog({ step, onClose }: { step: Step; onClose(): void }) {
  const [status, setStatus] = useState<GitHubWorkspaceStatus | null>(null);
  const title = step.owner ? "Connect GitHub for your workspace" : "GitHub is ready";
  const subtitle = step.owner
    ? "Optional. Connect it once and share it: every member and their agents then create repositories, open issues and push through it. You can do this later in Settings > Integrations."
    : `Nothing to set up: ${status?.shared?.sharedByName ?? step.sharedByName} shared the workspace's GitHub with everyone here.`;
  return (
    <CenteredDialog label={title} onClose={onClose} className="sm:max-w-lg">
      {(dismiss) => (
        <div className="flex flex-col gap-3 p-4 sm:p-5" data-workspace-github-setup={step.owner ? "owner" : "member"}>
          <div className="flex items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text" aria-hidden="true"><Github size={16} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
              <p className="text-[12.5px] leading-relaxed text-ink-secondary">{subtitle}</p>
            </div>
          </div>
          <div className="rounded-xl border border-hairline/50 p-1">
            <WorkspaceGitHubCard teamId={step.teamId} onStatus={setStatus} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {step.owner && !status?.shared
              ? <button type="button" className={ghostButton} onClick={dismiss}>Skip for now</button>
              : <button type="button" className={primaryButton} onClick={dismiss}>{step.owner ? "Done" : "Got it"}</button>}
          </div>
        </div>
      )}
    </CenteredDialog>
  );
}
