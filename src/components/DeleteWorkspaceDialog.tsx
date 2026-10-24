import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useWorkspaceAccess } from "@/lib/origin-members";
import { deleteLocalWorkspace, localWorkspaceContents } from "@/lib/origin-workspace-deletion";
import { exclusiveWithSync, requestOriginSync } from "@/lib/origin-sync";
import { switchWorkspace } from "@/lib/origin-workspaces";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { CenteredDialog } from "./CenteredDialog";
import { Notice, ghostButton, iconButton, inputClass, primaryButton, useAction } from "./origin-pages/ui";

export interface DeletionSummary {
  name: string; projects: string[]; projectCount: number; agentCount: number; memberCount: number; openIssueCount: number; countsCapped: boolean;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Deletes a workspace for good: everything in Origin for every member, and its agents on this computer. */
export function DeleteWorkspaceDialog({ head, cloudTeamId, nextHeadId, onClose }: { head: Bot; cloudTeamId: string | null; nextHeadId?: string; onClose(): void }) {
  const { state } = useStore();
  const titleId = useId();
  const access = useWorkspaceAccess(cloudTeamId);
  const refused = Boolean(cloudTeamId && access && access.role !== "owner" && access.role !== "admin");
  const summary = useCloudQuery<DeletionSummary>("workspaces:deletionSummary", cloudTeamId && !refused ? { teamId: cloudTeamId } : "skip");
  const name = summary?.name ?? head.name;
  const [typed, setTyped] = useState("");
  const action = useAction();
  const running = useRef(false);
  const cloudRemoved = useRef(false);
  const local = localWorkspaceContents(head.id, state.bots, state.groups, cloudTeamId);
  const ready = !cloudTeamId || summary !== undefined || cloudRemoved.current;
  const confirmed = ready && typed.trim() === name.trim();

  const remove = async (dismiss: () => void) => {
    if (!confirmed || running.current) return;
    running.current = true;
    const done = await action.run(() => exclusiveWithSync(async () => {
      await deleteLocalWorkspace(local, (path, init) => api(path, init), async () => {
        if (!cloudTeamId || cloudRemoved.current) return;
        await cloudMutation("workspaces:remove", { teamId: cloudTeamId, confirmName: typed }).catch((cause: unknown) => {
          throw new Error(`Its agents were deleted on this computer, but Origin kept the workspace: ${cause instanceof Error ? cause.message : String(cause)}`);
        });
        cloudRemoved.current = true;
      });
    }).finally(requestOriginSync), "Could not delete the workspace");
    running.current = false;
    if (!done) return;
    if (nextHeadId) switchWorkspace(nextHeadId);
    dismiss();
  };

  return createPortal(
    <CenteredDialog label={`Delete ${name}`} labelledBy={titleId} onClose={onClose} canClose={() => !running.current} className="sm:max-w-[480px]">{(dismiss) => <>
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <h2 id={titleId} className="text-[16px] font-semibold text-ink">Delete {name}?</h2>
        <button type="button" aria-label="Close" onClick={dismiss} disabled={action.busy} className={iconButton}><X size={16} /></button>
      </div>
      {refused ? <div className="grid gap-3 px-5 pb-5">
        <Notice>Only the workspace's owner or an admin can delete it. You can leave it from Members & invites.</Notice>
        <div className="flex justify-end"><button type="button" className={ghostButton} onClick={dismiss}>Close</button></div>
      </div> : <form className="grid gap-3 px-5 pb-5" onSubmit={(event) => { event.preventDefault(); void remove(dismiss); }}>
        <p className="text-[13px] text-ink-secondary">This cannot be undone.{cloudTeamId ? " It deletes the workspace for everyone in it:" : " It deletes from this computer:"}</p>
        <ul data-workspace-deletion-list className="list-disc space-y-1 pl-5 text-[13px] text-ink">
          {cloudTeamId && (summary ? <>
            <li>{plural(summary.projectCount, "project")}{summary.projects.length ? `: ${summary.projects.join(", ")}${summary.projectCount > summary.projects.length ? "…" : ""}` : ""}, with their issues ({plural(summary.openIssueCount, "open issue")}), boards, documents, Vault entries, assets and feedback</li>
            <li>{plural(summary.agentCount, "shared agent")}, their conversations and runs</li>
            <li>The workspace chat, calls, invitations and notifications</li>
            <li>Access for {plural(summary.memberCount, "member")}</li>
          </> : <li className="flex items-center gap-2 text-ink-secondary"><Loader2 size={13} className="animate-spin" />Counting what is in it</li>)}
          <li>On this computer: {plural(local.bots.length + 1, "agent")} with their conversations, files and memory{local.groups.length ? `, and ${plural(local.groups.length, "group chat")}` : ""}</li>
        </ul>
        {summary?.countsCapped && <p className="text-[12.5px] text-ink-tertiary">There is more than the numbers show; everything goes.</p>}
        <p className="text-[12.5px] text-ink-tertiary">GitHub repositories are kept; they are only unlinked.{nextHeadId ? "" : " This is your only workspace; afterwards you can create or join another."}</p>
        <label className="grid gap-1.5 text-[12.5px] text-ink-secondary">
          <span>Type <strong className="font-semibold text-ink">{name}</strong> to confirm</span>
          <input autoFocus className={inputClass} value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Workspace name" autoComplete="off" spellCheck={false} disabled={action.busy} />
        </label>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={ghostButton} onClick={dismiss} disabled={action.busy}>Cancel</button>
          <button type="submit" className={cn(primaryButton, "bg-danger text-white")} disabled={!confirmed || action.busy}>
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}Delete workspace
          </button>
        </div>
      </form>}
    </>}</CenteredDialog>,
    document.body,
  );
}
