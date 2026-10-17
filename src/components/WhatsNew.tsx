import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { appVersion } from "@/lib/app-links";
import { hasUnseenRelease, latestRelease, releaseDateLabel, releases, WHATS_NEW_SEEN_KEY } from "@/lib/origin-releases";

const PANEL_WIDTH = 340;
const GAP = 8;

function readSeen(): string | null {
  try { return localStorage.getItem(WHATS_NEW_SEEN_KEY); } catch { return null; }
}

function writeSeen(date: string) {
  try { localStorage.setItem(WHATS_NEW_SEEN_KEY, date); } catch { /* Storage can be blocked; the dot then returns next launch. */ }
}

type Placement = { left: number; bottom: number; maxHeight: number; width: number };

function placeAbove(anchor: DOMRect): Placement {
  const width = Math.min(PANEL_WIDTH, window.innerWidth - GAP * 2);
  const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - width - GAP));
  const bottom = Math.max(GAP, window.innerHeight - anchor.top + GAP);
  return { left, bottom, width, maxHeight: Math.max(160, window.innerHeight - bottom - GAP) };
}

export function WhatsNew({ variant = "button" }: { variant?: "button" | "icon" | "line" }) {
  const compact = variant === "icon";
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(() => hasUnseenRelease(readSeen()));
  const [placement, setPlacement] = useState<Placement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => { if (button.current) setPlacement(placeAbove(button.current.getBoundingClientRect())); };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

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
        <button ref={button} type="button" onClick={toggle} aria-label={`${label}, version ${appVersion()}`} aria-haspopup="dialog" aria-expanded={open}
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-[11.5px] text-ink-tertiary transition-colors hover:bg-raised hover:text-ink">
          {unread && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />}
          <span className={cn(unread && "text-ink-secondary")}>{"What's new"}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">v{appVersion()}</span>
        </button>
      ) : <button ref={button} type="button" onClick={toggle} aria-label={label} title="What's new" aria-haspopup="dialog" aria-expanded={open}
        className={cn("relative flex items-center gap-2 rounded-lg text-ink-secondary hover:bg-raised hover:text-ink",
          compact ? "size-7 justify-center" : "h-7 px-2 text-[13px]")}>
        <Sparkles size={14} />
        {!compact && <span>{"What's new"}</span>}
        {unread && <span aria-hidden="true" className={cn("size-1.5 rounded-full bg-accent", compact && "absolute right-1 top-1")} />}
      </button>}
      {open && placement && createPortal(
        <div ref={panel} role="dialog" aria-label="What's new"
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-hairline/60 bg-menu shadow-2xl shadow-black/60"
          style={{ left: placement.left, bottom: placement.bottom, width: placement.width, maxHeight: placement.maxHeight }}>
          <div className="flex items-center justify-between border-b border-hairline/50 px-3.5 py-2.5">
            <span className="text-[13px] font-semibold text-ink">{"What's new"}</span>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)}
              className="flex size-6 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink"><X size={13} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
            {releases.map((release, index) => (
              <article key={release.version} className={cn(index > 0 && "mt-4 border-t border-hairline/50 pt-4")}>
                <time dateTime={release.date} className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">{releaseDateLabel(release.date)}</time>
                <h3 className="mt-1 text-[14px] font-semibold text-ink">{release.title}</h3>
                <ul className="mt-2 space-y-2">
                  {release.changes.map((change) => (
                    <li key={change.title} className="flex gap-2 text-[12.5px] leading-relaxed">
                      <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-secondary" />
                      <span><span className="font-medium text-ink">{change.title}.</span> <span className="text-ink-secondary">{change.body}</span></span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
