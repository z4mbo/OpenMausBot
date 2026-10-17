import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { reducedMotion } from "./MenuMotion";

const DISMISS_MS = 120;

export function useDismiss(onClose: () => void): { closing: boolean; dismiss(): void } {
  const [closing, setClosing] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const dismiss = () => {
    if (timer.current) return;
    if (reducedMotion()) { close.current(); return; }
    setClosing(true);
    timer.current = window.setTimeout(() => close.current(), DISMISS_MS);
  };
  return { closing, dismiss };
}

export const overlayMotion = (closing: boolean) => (closing ? "origin-overlay-out pointer-events-none" : "origin-overlay-in");
export const sheetMotion = (closing: boolean) => (closing ? "origin-sheet-out" : "origin-sheet-in");

function tabStops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]")].filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled, input[type='hidden']")) return false;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.inert) return false;
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (parent === panel) break;
    }
    return true;
  });
}

export function CenteredDialog({ label, labelledBy, onClose: requestClose, canClose, className, children }: {
  label: string; labelledBy?: string; onClose(): void; canClose?(): boolean; className?: string; children(dismiss: () => void): ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { closing, dismiss: animateOut } = useDismiss(requestClose);
  const dismiss = () => { if (canClose?.() !== false) animateOut(); };
  const close = useRef(dismiss);
  close.current = dismiss;
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll("[data-centered-dialog]");
      if (dialogs[dialogs.length - 1] !== panel.current) return;
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = tabStops(panel.current);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); panel.current.focus(); return; }
      if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus({ preventScroll: true });
    return () => { window.removeEventListener("keydown", onKey); if (returnTo?.isConnected) returnTo.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className={cn("fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/55", overlayMotion(closing))}>
      <div className="flex min-h-full items-end justify-center sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} data-centered-dialog tabIndex={-1} style={{ outline: "none" }}
          className={cn("w-full rounded-t-2xl border border-hairline/60 bg-app max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)] sm:rounded-[18px]", sheetMotion(closing), className)}>
          {children(dismiss)}
        </div>
      </div>
    </div>
  );
}
