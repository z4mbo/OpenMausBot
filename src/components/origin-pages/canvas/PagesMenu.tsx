import { useRef, useState, type CSSProperties } from "react";
import { Check, Copy, ExternalLink, Globe, Loader2 } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { errorText } from "../repo-url";
import { countLabel, useCopied, type PagesList, type PublishedPage } from "./pages-data";

const rowButton = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40";

/** The project's published pages, opened from the Canvas header: where each lives, its views and the leads it collected. */
export function PagesMenu({ projectId, canEdit, canvasName, onOpenCanvas }: { projectId: string; canEdit: boolean; canvasName(id: string): string | undefined; onOpenCanvas(id: string): void }) {
  const list = useCloudQuery<PagesList>("pages:list", { projectId });
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, root, () => setOpen(false));
  const pages = list?.pages ?? [];
  return (
    <div ref={root} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setTop((root.current?.getBoundingClientRect().bottom ?? 0) + 6); setOpen((value) => !value); }}
        className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-ink-secondary outline-none transition-colors hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60", open && "bg-raised text-ink")}>
        <Globe size={14} aria-hidden="true" />Pages{pages.length > 0 && <span className="tabular-nums text-ink-tertiary">{pages.length}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Published pages" style={{ "--menu-top": `${top}px` } as CSSProperties} className="absolute right-0 top-full z-40 mt-1.5 flex max-h-[min(480px,70vh)] w-[min(380px,calc(100vw-24px))] max-sm:fixed max-sm:inset-x-3 max-sm:top-[var(--menu-top)] max-sm:mt-0 max-sm:w-auto flex-col overflow-hidden rounded-xl border border-hairline/60 bg-menu animate-pop-in">
          {list && !list.captureEnabled && pages.some((page) => page.leadForms > 0) && (
            <p className="border-b border-hairline/40 px-3 py-2 text-[12px] text-danger">Lead capture is off in Pipeline, so these forms turn signups away.</p>
          )}
          {list === undefined ? (
            <p className="px-3 py-3 text-[12.5px] text-ink-tertiary">Loading pages…</p>
          ) : pages.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] leading-snug text-ink-secondary">No published pages yet. Select a top-level frame and publish it from the Design panel.</p>
          ) : (
            <ul className="min-h-0 overflow-y-auto p-1">
              {pages.map((page) => <PageRow key={page._id} page={page} projectId={projectId} canEdit={canEdit} canvasName={canvasName(page.canvasId)}
                onOpen={() => { setOpen(false); onOpenCanvas(page.canvasId); }} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PageRow({ page, projectId, canEdit, canvasName, onOpen }: { page: PublishedPage; projectId: string; canEdit: boolean; canvasName?: string; onOpen(): void }) {
  const [copied, copy] = useCopied();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unpublish = async () => {
    setBusy(true);
    try { await cloudMutation("pages:unpublish", { projectId, pageId: page._id }); }
    catch (cause) { setError(errorText(cause, "Could not unpublish")); setBusy(false); setConfirming(false); }
  };
  return (
    <li className="group rounded-lg px-2 py-1.5 transition-colors hover:bg-raised/50 focus-within:bg-raised/50">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          title={canvasName ? `Open ${canvasName}` : undefined}>{page.title}</button>
        <button type="button" className={rowButton} aria-label={copied === page.url ? "Copied" : `Copy the address of ${page.title}`} onClick={() => copy(page.url)}>
          {copied === page.url ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <a href={page.url} target="_blank" rel="noreferrer" className={rowButton} aria-label={`Open ${page.title}`}><ExternalLink size={13} /></a>
      </div>
      <a href={page.url} target="_blank" rel="noreferrer" className="block truncate text-[11.5px] text-ink-tertiary outline-none hover:text-ink-secondary focus-visible:ring-2 focus-visible:ring-accent/60">{page.url.replace(/^https?:\/\//, "")}</a>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] tabular-nums text-ink-secondary">
        <span>{countLabel(page.views, "view", "views")}</span>
        <span className={cn(page.leads > 0 && "text-accent-text")}>{page.leadForms ? countLabel(page.leads, "lead", "leads") : "No form"}</span>
        {canvasName && <span className="min-w-0 truncate text-ink-tertiary">{canvasName}</span>}
        {canEdit && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {confirming ? (
              <>
                <button type="button" disabled={busy} onClick={() => void unpublish()} className="rounded px-1.5 py-0.5 text-danger outline-none hover:bg-danger/15 focus-visible:ring-2 focus-visible:ring-danger/60">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : "Take it down"}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded px-1.5 py-0.5 text-ink-secondary outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60">Keep</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="rounded px-1.5 py-0.5 text-ink-tertiary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">Unpublish</button>
            )}
          </span>
        )}
      </div>
      {error && <p role="alert" className="mt-0.5 text-[11.5px] text-danger">{error}</p>}
    </li>
  );
}
