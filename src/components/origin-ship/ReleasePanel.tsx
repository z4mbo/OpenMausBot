import { useEffect, useState } from "react";
import { Check, ExternalLink, GitMerge, Loader2, Megaphone, PackageCheck, RefreshCw, Sparkles, Tag, Trash2, X } from "lucide-react";
import { cloudMutation } from "@/lib/origin-cloud";
import { originShip } from "@/lib/origin-ship";
import { cn } from "@/lib/cn";
import { isReleaseTag, SHIP_LIMITS, type ShipRelease, type ShipTarget } from "../../../shared/origin-ship";
import { Select } from "../Select";
import { EmptyState, Field, Notice, cardClass, ghostButton, inputClass, primaryButton } from "../origin-pages/ui";
import { errorText } from "../origin-pages/repo-url";
import { releaseSteps, timeAgo } from "./ship-model";

type Writer = { botId: string; name: string };
type Outcome = { tone: "info" | "danger"; text: string; url?: string; postId?: string };

export function ReleasePanel({ projectId, projectName, releases, targets, canEdit, isAdmin, writer, onAskChief, onPublished, onOpenBroadcast }: {
  projectId: string;
  projectName: string;
  releases: ShipRelease[];
  targets: ShipTarget[];
  canEdit: boolean;
  isAdmin: boolean;
  writer: Writer;
  onAskChief(): void;
  onPublished(): void;
  onOpenBroadcast(): void;
}) {
  const open = releases.find((release) => release.status !== "published");
  const [drafting, setDrafting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const draft = async () => {
    setDrafting(true);
    setOutcome(null);
    try {
      const made = await originShip.draftRelease(projectId, projectName, writer);
      if (!made.pulls) setOutcome({ tone: "info", text: "Nothing was merged since the last release; the draft lists no pull requests." });
    } catch (cause) {
      setOutcome({ tone: "danger", text: errorText(cause, "Could not draft the release") });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Release">
      {outcome && (
        <div className="flex flex-wrap items-center gap-2" role={outcome.tone === "danger" ? "alert" : "status"}>
          <Notice tone={outcome.tone}>{outcome.text}</Notice>
          {outcome.url && <a className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} href={outcome.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />Open release</a>}
          {outcome.postId && <button type="button" className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} onClick={onOpenBroadcast}><Megaphone size={12} />Review announcement</button>}
        </div>
      )}
      {open ? (
        <ReleaseEditor key={open._id} projectId={projectId} release={open} targets={targets} canEdit={canEdit} isAdmin={isAdmin} drafting={drafting}
          onRedraft={() => void draft()}
          onPublish={async () => {
            const result = await originShip.publishRelease(projectId, open._id, writer);
            setOutcome({
              tone: "info", url: result.url, ...(result.postId ? { postId: result.postId } : {}),
              text: [`Released ${result.tag}.`, ...result.deployed, result.postId ? "The announcement waits for approval in Broadcast." : ""].filter(Boolean).join(" "),
            });
            onPublished();
          }} />
      ) : (
        <div className={cn(cardClass, "flex flex-wrap items-center gap-3 p-3")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><PackageCheck size={15} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1 basis-56">
            <h3 className="text-[14px] font-semibold text-ink">Next release</h3>
            <p className="text-[12.5px] leading-snug text-ink-secondary">{writer.name} writes notes from the pull requests merged since the last tag. You edit and approve before anything is published.</p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={ghostButton} onClick={onAskChief}><Sparkles size={14} />Ask {writer.name} to ship</button>
              <button type="button" className={primaryButton} disabled={drafting} onClick={() => void draft()}>
                {drafting ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}Draft release
              </button>
            </div>
          )}
        </div>
      )}
      <History releases={releases.filter((release) => release.status === "published")} onOpenBroadcast={onOpenBroadcast} />
    </section>
  );
}

function ReleaseEditor({ projectId, release, targets, canEdit, isAdmin, drafting, onRedraft, onPublish }: {
  projectId: string; release: ShipRelease; targets: ShipTarget[]; canEdit: boolean; isAdmin: boolean; drafting: boolean; onRedraft(): void; onPublish(): Promise<void>;
}) {
  const [tag, setTag] = useState(release.tag);
  const [title, setTitle] = useState(release.title === release.tag ? "" : release.title);
  const [notes, setNotes] = useState(release.notes);
  const [targetId, setTargetId] = useState(release.targetId ?? "");
  const [announce, setAnnounce] = useState(release.announce);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(release.status === "failed" ? release.error ?? "" : "");
  useEffect(() => {
    setTag(release.tag);
    setTitle(release.title === release.tag ? "" : release.title);
    setNotes(release.notes);
    setTargetId(release.targetId ?? "");
    setAnnounce(release.announce);
  }, [release.updatedAt]);
  const dirty = tag !== release.tag || (title || tag) !== release.title || notes !== release.notes || targetId !== (release.targetId ?? "") || announce !== release.announce;
  const validTag = isReleaseTag(tag.trim());
  const publishing = release.status === "publishing";
  const editable = canEdit && !publishing && !busy;

  const save = () => cloudMutation("ship:saveRelease", { projectId, releaseId: release._id, tag, title: title || tag, notes, targetId: targetId || null, announce });
  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (cause) {
      setError(errorText(cause, fallback));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={cn(cardClass, "flex flex-col gap-3 p-3")} aria-label={`Release ${release.tag}`} data-ship-release={release._id}>
      <header className="flex flex-wrap items-center gap-2">
        <Tag size={15} className="text-ink-secondary" aria-hidden="true" />
        <h3 className="text-[14px] font-semibold text-ink">Release draft</h3>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", release.status === "failed" ? "bg-danger/10 text-danger" : publishing ? "bg-accent/15 text-accent-text motion-safe:animate-pulse" : "bg-warning/15 text-warning")}>
          {release.status === "failed" ? "Failed" : publishing ? "Publishing" : "Waiting for approval"}
        </span>
        <span className="text-[12px] text-ink-tertiary">{release.agentName ? `Drafted by ${release.agentName}` : "Drafted"} {timeAgo(release.updatedAt)}{release.baseTag ? ` · since ${release.baseTag}` : ""}</span>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <Field label="Tag">
          <input className={cn(inputClass, "font-mono", !validTag && "border-danger/60")} value={tag} maxLength={SHIP_LIMITS.tag} disabled={!editable} onChange={(event) => setTag(event.target.value)} aria-invalid={!validTag} />
        </Field>
        <Field label="Title (optional)">
          <input className={inputClass} value={title} maxLength={SHIP_LIMITS.title} disabled={!editable} placeholder={tag} onChange={(event) => setTitle(event.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={cn(inputClass, "min-h-44 resize-y font-[inherit] leading-relaxed")} value={notes} maxLength={SHIP_LIMITS.notes} disabled={!editable} onChange={(event) => setNotes(event.target.value)} />
      </Field>

      {release.pulls.length > 0 && (
        <details className="group text-[12.5px]">
          <summary className="cursor-pointer select-none rounded text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60">
            {release.pulls.length} merged pull request{release.pulls.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {release.pulls.map((pull) => (
              <li key={pull.number} className="flex min-w-0 items-center gap-2">
                <GitMerge size={12} className="shrink-0 text-accent-text" aria-hidden="true" />
                <a href={pull.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-ink hover:underline">{pull.title}</a>
                <span className="shrink-0 text-ink-tertiary">#{pull.number}{pull.author ? ` · ${pull.author}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Then deploy" className="min-w-44 flex-1 sm:flex-none">
          <Select value={targetId} disabled={!editable} onChange={(event) => setTargetId(event.target.value)} aria-label="Deploy after release">
            <option value="">Don't deploy</option>
            {targets.map((target) => <option key={target._id} value={target._id}>{target.name}</option>)}
          </Select>
        </Field>
        <label className="flex min-h-9 items-center gap-2 text-[12.5px] text-ink-secondary">
          <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={announce} disabled={!editable} onChange={(event) => setAnnounce(event.target.checked)} />
          Draft an announcement in Broadcast
        </label>
      </div>

      {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-lg bg-inset/60 p-2.5 motion-safe:animate-pop-in" role="group" aria-label="Confirm release">
          <p className="text-[12.5px] text-ink">Approving will:</p>
          <ol className="list-decimal pl-5 text-[12.5px] text-ink-secondary">
            {releaseSteps({ tag: tag.trim(), announce, targetId: targetId || undefined }, targets).map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div className="flex gap-2">
            <button type="button" className={primaryButton} disabled={busy} onClick={() => void act(async () => {
              if (dirty) await save();
              await onPublish();
              setConfirming(false);
            }, "Could not publish the release")}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Approve &amp; release
            </button>
            <button type="button" className={ghostButton} disabled={busy} onClick={() => setConfirming(false)}><X size={14} />Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <button type="button" className={ghostButton} disabled={!editable} onClick={() => void act(async () => {
            if (window.confirm(`Delete the ${release.tag} draft?`)) await cloudMutation("ship:removeRelease", { projectId, releaseId: release._id });
          }, "Could not delete the draft")}><Trash2 size={14} />Discard</button>}
          {canEdit && <button type="button" className={ghostButton} disabled={!editable || drafting} title="Read the merged pull requests again and rewrite the notes"
            onClick={() => { if (!dirty || window.confirm("Rewrite the notes? Your edits are replaced.")) onRedraft(); }}>
            {drafting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Rewrite
          </button>}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && dirty && <button type="button" className={ghostButton} disabled={!editable || !validTag} onClick={() => void act(save, "Could not save the draft")}>Save</button>}
            {isAdmin ? (
              <button type="button" className={primaryButton} disabled={!editable || !validTag} onClick={() => setConfirming(true)}><PackageCheck size={14} />Approve &amp; release</button>
            ) : <span className="text-[12px] text-ink-tertiary">A project admin approves releases.</span>}
          </span>
        </div>
      )}
    </article>
  );
}

function History({ releases, onOpenBroadcast }: { releases: ShipRelease[]; onOpenBroadcast(): void }) {
  if (!releases.length) return null;
  return (
    <section aria-label="Releases" className="flex flex-col gap-2">
      <h3 className="px-0.5 text-[13.5px] font-semibold text-ink">Releases</h3>
      <ol className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
        {releases.map((release) => (
          <li key={release._id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[12.5px]">
            <code className="shrink-0 font-mono font-medium text-ink">{release.tag}</code>
            <span className="min-w-0 flex-1 basis-40 truncate text-ink-secondary">{release.title !== release.tag ? release.title : `${release.pulls.length} pull request${release.pulls.length === 1 ? "" : "s"}`}</span>
            <span className="shrink-0 text-ink-tertiary">{release.approvedByName ? `${release.approvedByName} · ` : ""}{timeAgo(release.publishedAt ?? release.updatedAt)}</span>
            <span className="flex shrink-0 items-center gap-1">
              {release.broadcastPostId && <button type="button" className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} onClick={onOpenBroadcast}><Megaphone size={12} />Post</button>}
              {release.releaseUrl && <a className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} href={release.releaseUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} />GitHub</a>}
            </span>
            {release.deployNote && <p className="basis-full text-[12px] text-ink-tertiary">{release.deployNote}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function NoRepository({ onOpenSettings }: { onOpenSettings(): void }) {
  return <EmptyState compact icon={<Tag size={20} />} title="No repository linked" body="Releases are tagged on the project's GitHub repository. Link one in Settings."
    action={<button type="button" className={ghostButton} onClick={onOpenSettings}>Open settings</button>} />;
}
