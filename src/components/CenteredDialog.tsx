import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { reducedMotion } from "./MenuMotion";
import { ModalFocusScope, useModalDialog } from "@/hooks/use-modal-dialog";

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

export function CenteredDialog({ label, labelledBy, onClose: requestClose, canClose, className, children }: {
  label: string; labelledBy?: string; onClose(): void; canClose?(): boolean; className?: string; children(dismiss: () => void): ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { closing, dismiss: animateOut } = useDismiss(requestClose);
  const { dismiss } = useModalDialog(panel, animateOut, { canClose });
  return (
    <div className={cn("fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/55", overlayMotion(closing))}>
      <div className="flex min-h-full items-end justify-center sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} data-centered-dialog tabIndex={-1} style={{ outline: "none" }}
          className={cn("w-full rounded-t-2xl border border-hairline/60 bg-app max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)] sm:rounded-[18px]", sheetMotion(closing), className)}>
          <ModalFocusScope panelRef={panel}>{children(dismiss)}</ModalFocusScope>
        </div>
      </div>
    </div>
  );
}
