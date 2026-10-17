import { useState } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCloudQuery, useCloudSession } from "@/lib/origin-cloud";
import { useWorkspaceAccess, useWorkspaceMembers } from "@/lib/origin-members";
import { accessSummary, currentAccess, seesEveryProject, updateProjectAccess, type ProjectAccess } from "@/lib/origin-project-access";
import { Loading, Notice, cardClass, ghostButton, primaryButton, useAction } from "../origin-pages/ui";
import { ProjectAccessPicker } from "./ProjectAccessPicker";

type ProjectRow = { _id: string; email: string; role: "owner" | "admin" | "member" | "viewer"; status: string };

const sameAccess = (a: ProjectAccess, b: ProjectAccess) =>
  a.mode === b.mode && (a.mode !== "people" || (a.emails.length === b.emails.length && a.emails.every((email) => b.emails.some((other) => other.toLowerCase() === email.toLowerCase()))));

/** Project settings: who in the workspace sees this project. Only workspace admins change it. */
export function ProjectAccessCard({ projectId, teamId }: { projectId: string; teamId: string | undefined }) {
  const session = useCloudSession();
  const myEmail = session.user?.email ?? "";
  const members = useWorkspaceMembers(teamId ?? null);
  const access = useWorkspaceAccess(teamId ?? null);
  const isAdmin = Boolean(access && seesEveryProject(access.role));
  const rows = useCloudQuery<ProjectRow[]>("members:list", { projectId });
  const [draft, setDraft] = useState<ProjectAccess | null>(null);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  if (!teamId) return null;
  const loaded = members && rows;
  const current = loaded ? currentAccess(rows, members, myEmail) : null;
  const value = draft ?? current;
  const dirty = Boolean(draft && current && !sameAccess(draft, current));
  const save = async () => {
    if (!draft || !members) return;
    setSaved(false);
    if (await action.run(() => updateProjectAccess({ projectId, access: draft, members, myEmail }), "Could not change who has access")) {
      setDraft(null);
      setSaved(true);
    }
  };
  return (
    <section className={cn(cardClass, "p-4")} aria-label="Project access">
      <h3 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-ink"><span className="text-ink-secondary"><Lock size={15} /></span>Access</h3>
      <p className="mb-3 text-[12.5px] text-ink-secondary">{value && members ? accessSummary(value, members, myEmail) : "Who can see this project"}</p>
      {!loaded || !value ? <Loading label="Loading access" /> : (
        <>
          <ProjectAccessPicker members={members} myEmail={myEmail} value={value} disabled={!isAdmin || action.busy}
            onChange={(next) => { setSaved(false); setDraft(next); }} />
          {action.error && <div className="mt-3"><Notice tone="danger">{action.error}</Notice></div>}
          {!isAdmin ? <div className="mt-3"><Notice>Only workspace admins can change who has access.</Notice></div> : (
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className={primaryButton} disabled={!dirty || action.busy || (draft?.mode === "people" && draft.emails.length === 0)} onClick={() => void save()}>
                {action.busy ? <Loader2 size={14} className="animate-spin" /> : saved && !dirty ? <Check size={14} /> : null}{saved && !dirty ? "Saved" : "Save access"}
              </button>
              {dirty && <button type="button" className={ghostButton} disabled={action.busy} onClick={() => setDraft(null)}>Reset</button>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
