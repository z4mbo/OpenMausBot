import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { reducedMotion } from "./MenuMotion";

/** Matches `.origin-sheet-out` and `.origin-overlay-out` in styles.css. */
const DISMISS_MS = 120;

/** Plays a dialog's exit before `onClose` unmounts it; with reduced motion it closes at once. */
export function useDismiss(onClose: () => void): { closing: boolean; dismiss(): void } {
  const [closing, setClosing] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const dismiss = () => {
    if (closing) return;
    if (reducedMotion()) { close.current(); return; }
    setClosing(true);
    timer.current = window.setTimeout(() => close.current(), DISMISS_MS);
  };
  return { closing, dismiss };
}

export const overlayMotion = (closing: boolean) => (closing ? "origin-overlay-out pointer-events-none" : "origin-overlay-in");
export const sheetMotion = (closing: boolean) => (closing ? "origin-sheet-out" : "origin-sheet-in");

/**
 * The centred dialog shared by the issue composer, the issue page, search and What's new: page-toned and flat,
 * a bottom sheet on phones. `children` receives the animated dismiss for its own close buttons;
 * `canClose` runs before the exit plays, so a refusal leaves the dialog open.
 */
export function CenteredDialog({ label, onClose: requestClose, canClose, className, children }: {
  label: string; onClose(): void; canClose?(): boolean; className?: string; children(dismiss: () => void): ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { closing, dismiss: animateOut } = useDismiss(requestClose);
  const dismiss = () => { if (canClose?.() !== false) animateOut(); };
  const close = useRef(dismiss);
  close.current = dismiss;
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus({ preventScroll: true });
    return () => { window.removeEventListener("keydown", onKey); returnTo?.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className={cn("fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/55", overlayMotion(closing))}>
      <div className="flex min-h-full items-end justify-center sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} style={{ outline: "none" }}
          className={cn("w-full rounded-t-2xl border border-hairline/60 bg-appmax-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)] sm:rounded-[18px]", sheetMotion(closing), className)}>
          {children(dismiss)}
        </div>
      </div>
    </div>
  );
}
