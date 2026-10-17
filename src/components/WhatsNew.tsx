import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { appVersion } from "@/lib/app-links";
import { CenteredDialog } from "./CenteredDialog";
import { hasUnseenRelease, latestRelease, releaseDateLabel, releases, WHATS_NEW_SEEN_KEY } from "@/lib/origin-releases";

function readSeen(): string | null {
  try { return localStorage.getItem(WHATS_NEW_SEEN_KEY); } catch { return null; }
}

function writeSeen(date: string) {
  try { localStorage.setItem(WHATS_NEW_SEEN_KEY, date); } catch { /* Storage can be blocked; the dot then returns next launch. */ }
}

export function WhatsNew({ variant = "button" }: { variant?: "button" | "icon" | "line" }) {
  const compact = variant === "icon";
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(() => hasUnseenRelease(readSeen()));

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === WHATS_NEW_SEEN_KEY) setUnread(hasUnseenRelease(event.newValue)); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const toggle = () => {
    if (!open) {
      writeSeen(latestRelease.date);
      setUnread(false);
    }
    setOpen((value) => !value);
  };

  const label = unread ? "What's new, unread update" : "What's new";

  return (
    <>
      {variant === "line" ? (
        <button type="button" onClick={toggle} aria-label={`${label}, version ${appVersion()}`} aria-haspopup="dialog" aria-expanded={open}
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-[11.5px] text-ink-tertiary transition-colors hover:bg-raised hover:text-ink">
          {unread && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />}
          <span className={cn(unread && "text-ink-secondary")}>{"What's new"}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">v{appVersion()}</span>
        </button>
      ) : <button type="button" onClick={toggle} aria-label={label} title="What's new" aria-haspopup="dialog" aria-expanded={open}
        className={cn("relative flex items-center gap-2 rounded-lg text-ink-secondary hover:bg-raised hover:text-ink",
          compact ? "size-7 justify-center" : "h-7 px-2 text-[13px]")}>
        <Sparkles size={14} />
        {!compact && <span>{"What's new"}</span>}
        {unread && <span aria-hidden="true" className={cn("size-1.5 rounded-full bg-accent", compact && "absolute right-1 top-1")} />}
      </button>}
      {open && createPortal(
        <CenteredDialog label="What's new" onClose={() => setOpen(false)} className="flex h-[min(680px,85dvh)] flex-col overflow-hidden sm:max-w-[680px]">
          {(dismiss) => <>
            <div className="flex items-center gap-2 border-b border-hairline/40 px-6 py-4 max-sm:px-5">
              <Sparkles size={16} className="shrink-0 text-accent-text" aria-hidden="true" />
              <h2 className="text-[15px] font-semibold text-ink">{"What's new"}</h2>
              <span className="text-[12px] tabular-nums text-ink-tertiary">v{appVersion()}</span>
              <button type="button" aria-label="Close" onClick={dismiss}
                className="ml-auto flex size-8 items-center justify-center rounded-lg text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 max-sm:px-5">
              {releases.map((release, index) => (
                <article key={release.version} className={cn(index > 0 && "mt-6 border-t border-hairline/40 pt-6")}>
                  <time dateTime={release.date} className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">{releaseDateLabel(release.date)}</time>
                  <h3 className="mt-1 text-[16px] font-semibold text-ink">{release.title}</h3>
                  <ul className="mt-3 space-y-2.5">
                    {release.changes.map((change) => (
                      <li key={change.title} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                        <span aria-hidden="true" className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-secondary" />
                        <span><span className="font-medium text-ink">{change.title}.</span> <span className="text-ink-secondary">{change.body}</span></span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </>}
        </CenteredDialog>,
        document.body,
      )}
    </>
  );
}
