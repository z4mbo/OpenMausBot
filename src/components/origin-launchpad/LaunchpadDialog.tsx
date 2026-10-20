import { useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, Loader2, Rocket, Settings2 } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { handOff } from "@/lib/origin-handoff";
import { useShowThreads } from "@/lib/thread-preferences";
import { accessSummary, type ProjectAccess, type RepositoryChoice } from "@/lib/origin-project-access";
import { useActiveOriginWorkspace, useWorkspacePeople } from "@/lib/use-origin-workspace";
import { chiefDraft, createLaunchProject, needsLocalAutoConsent } from "@/lib/launchpad-create";
import type { BotCreationDraft } from "@/lib/bot-creation-draft";
import { LAUNCH_LIMITS, kickoffBrief, projectNameFromIdea, type LaunchIdea } from "../../../shared/origin-launchpad";
import { CenteredDialog } from "../CenteredDialog";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { ProjectAccessPicker } from "../origin-members/ProjectAccessPicker";
import { RepositoryPicker, repositoryChoiceReady } from "../origin-members/RepositoryPicker";
import { Notice, ghostButton, inputClass, primaryButton } from "../origin-pages/ui";
import { errorText } from "../origin-pages/repo-url";

/** Launchpad for a new project in a workspace, or for an existing project's Chief. */
export type LaunchTarget = { kind: "new"; onManual?(): void } | { kind: "project"; chief: Bot; projectName: string };

const REPOSITORY_SUMMARY: Record<RepositoryChoice["mode"], string> = { new: "new private GitHub repository", existing: "existing repository", later: "no repository yet" };

function Text({ label, hint, value, onChange, max, rows = 2, autoFocus }: { label: string; hint?: string; value: string; onChange(value: string): void; max: number; rows?: number; autoFocus?: boolean }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-secondary">
      <span>{label}{hint && <span className="font-normal text-ink-tertiary"> · {hint}</span>}</span>
      <textarea autoFocus={autoFocus} rows={rows} maxLength={max} value={value} onChange={(event) => onChange(event.target.value)} className={cn(inputClass, "resize-y leading-relaxed")} />
    </label>
  );
}

export function LaunchpadDialog({ target, onClose }: { target: LaunchTarget; onClose(): void }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const workspace = useActiveOriginWorkspace();
  const people = useWorkspacePeople(target.kind === "new" ? workspace.teamId : null);
  const [input, setInput] = useState<Required<LaunchIdea>>({ idea: "", audience: "", constraints: "", links: "" });
  const [name, setName] = useState<string | null>(null);
  const [access, setAccess] = useState<ProjectAccess>({ mode: "everyone", emails: [] });
  const [repository, setRepository] = useState<RepositoryChoice>({ mode: "new", name: null });
  const [settings, setSettings] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<BotCreationDraft | null>(null);
  const set = (key: keyof LaunchIdea) => (value: string) => setInput((current) => ({ ...current, [key]: value }));
  const projectName = (name ?? projectNameFromIdea(input.idea)).trim();
  const busy = Boolean(progress);
  const teamId = workspace.teamId;
  const ready = input.idea.trim().length > 0 && (target.kind === "project" || (Boolean(projectName) && Boolean(teamId) && people.members !== undefined
    && (access.mode !== "people" || access.emails.length > 0) && repositoryChoiceReady(repository, projectName)));

  const create = async (draft: BotCreationDraft) => {
    if (!teamId || !people.members) return;
    try {
      const { bot, warnings } = await createLaunchProject({ draft, teamId, headId: workspace.headId, access, repository, members: people.members, myEmail: people.myEmail, dispatch, onProgress: setProgress });
      if (warnings.length) dispatch({ type: "error", message: warnings.join("\n") });
      handOff(dispatch, bot, kickoffBrief(bot.name, input), showThreads);
      onClose();
    } catch (cause) {
      setError(errorText(cause, "Could not create the project"));
      setProgress("");
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setError("");
    if (target.kind === "project") {
      handOff(dispatch, target.chief, kickoffBrief(target.projectName, input), showThreads);
      onClose();
      return;
    }
    setProgress("Preparing…");
    try {
      const draft = await chiefDraft(projectName);
      if (needsLocalAutoConsent(draft)) { setProgress(""); setConsent(draft); return; }
      await create(draft);
    } catch (cause) {
      setError(errorText(cause, "Could not create the project"));
      setProgress("");
    }
  };

  const title = target.kind === "new" ? "New project from an idea" : `Plan ${target.projectName} from an idea`;
  return (
    <CenteredDialog label={title} onClose={onClose} canClose={() => !busy} className="sm:max-w-xl">
      {(dismiss) => (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 p-4 sm:p-5" aria-busy={busy} data-launchpad>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text" aria-hidden="true"><Rocket size={16} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
              <p className="text-[12.5px] text-ink-secondary">{target.kind === "new" ? "Its Chief" : target.chief.name} writes the Brief, milestones and the MVP's Draft issues.</p>
            </div>
          </div>
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3">
            <Text label="Idea" value={input.idea} onChange={set("idea")} max={LAUNCH_LIMITS.idea} rows={4} autoFocus />
            <div className="grid gap-3 sm:grid-cols-2">
              <Text label="Audience" hint="optional" value={input.audience} onChange={set("audience")} max={LAUNCH_LIMITS.audience} />
              <Text label="Constraints" hint="budget, timeline, stack" value={input.constraints} onChange={set("constraints")} max={LAUNCH_LIMITS.constraints} />
            </div>
            <Text label="Links" hint="competitors, references" value={input.links} onChange={set("links")} max={LAUNCH_LIMITS.links} rows={1} />
            {target.kind === "new" && (teamId ? (
              <>
                <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-secondary">Project name
                  <input className={inputClass} maxLength={LAUNCH_LIMITS.name} value={name ?? projectNameFromIdea(input.idea)} placeholder="Named from the idea" onChange={(event) => setName(event.target.value)} />
                </label>
                <Disclosure open={settings} onToggle={() => setSettings((open) => !open)}
                  summary={`${people.members ? accessSummary(access, people.members, people.myEmail) : "Loading people…"} · ${REPOSITORY_SUMMARY[repository.mode]}`}>
                  <ProjectAccessPicker members={people.members} myEmail={people.myEmail} value={access} onChange={setAccess} disabled={busy} />
                  <RepositoryPicker teamId={teamId} projectName={projectName} value={repository} onChange={setRepository} disabled={busy} />
                </Disclosure>
              </>
            ) : <Notice>Launchpad creates shared projects. Open a workspace connected to Origin first.</Notice>)}
          </fieldset>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {target.kind === "new" && target.onManual && (
              <button type="button" className="mr-auto rounded-lg px-2 py-1.5 text-[12.5px] text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60" disabled={busy} onClick={target.onManual}>
                Set up manually
              </button>
            )}
            <button type="button" className={cn(ghostButton, !(target.kind === "new" && target.onManual) && "ml-auto")} disabled={busy} onClick={dismiss}>Cancel</button>
            <button type="submit" className={primaryButton} disabled={!ready || busy}>
              {busy ? <><Loader2 size={14} className="animate-spin" />{progress}</> : <><Rocket size={14} />{target.kind === "new" ? "Create and plan" : `Send to ${target.chief.name}`}</>}
            </button>
          </div>
          <LocalComputerAutoWarning open={consent !== null} onCancel={() => setConsent(null)}
            onConfirm={() => { const draft = consent!; draft.consent.acknowledgeLocalAuto = true; setConsent(null); setProgress("Preparing…"); void create(draft); }} />
        </form>
      )}
    </CenteredDialog>
  );
}

function Disclosure({ open, onToggle, summary, children }: { open: boolean; onToggle(): void; summary: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-hairline/50">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-[12.5px] text-ink-secondary outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
        <Settings2 size={14} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 transition-transform duration-(--motion-fast)", open && "rotate-90")} />
      </button>
      {open && <div className="flex flex-col gap-3 border-t border-hairline/40 p-3 motion-safe:animate-pop-in">{children}</div>}
    </div>
  );
}
