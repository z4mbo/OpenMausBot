import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/cn";
import { ModalFocusScope, useModalDialog } from "@/hooks/use-modal-dialog";

export type ConfirmTone = "danger" | "neutral";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  details?: ReactNode;
  confirmLabel: string;
  tone?: ConfirmTone;
  icon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  openerRef?: RefObject<HTMLElement | null>;
}

/**
 * Cancel is focused by default so a stray Enter never confirms. Portalled to <body>: the sidebar's translate below md
 * would become the containing block.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onCancel, returnFocusRef } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { dismiss, focus } = useModalDialog(dialogRef, onCancel, {
    open, initialFocusRef: cancelRef, returnFocusRef: props.openerRef, fallbackFocusRef: returnFocusRef, canClose: () => !props.pending,
  });
  useEffect(() => {
    if (!open) return;
    if (props.pending) focus();
    else if (dialogRef.current === document.activeElement) cancelRef.current?.focus();
  }, [open, props.pending]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
      onMouseDown={(event) => event.target === event.currentTarget && dismiss()}
    >
      <ModalFocusScope panelRef={dialogRef}><ConfirmDialogCard ref={dialogRef} cancelRef={cancelRef} {...props} /></ModalFocusScope>
    </div>,
    document.body,
  );
}

export function ConfirmDialogCard({
  ref,
  cancelRef,
  title,
  body,
  details,
  confirmLabel,
  tone = "danger",
  icon,
  onCancel,
  onConfirm,
  pending = false,
}: ConfirmDialogProps & {
  ref?: React.Ref<HTMLDivElement>;
  cancelRef?: React.Ref<HTMLButtonElement>;
}) {
  const danger = tone === "danger";
  return (
    <div
      ref={ref}
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-busy={pending}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-body"
      className={cn(
        "w-full max-w-[420px] rounded-2xl border bg-panel p-5 shadow-2xl",
        danger ? "border-danger/30" : "border-hairline/50",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 shrink-0", danger ? "text-danger" : "text-warning")}>
          {icon ?? <AlertTriangle size={18} />}
        </span>
        <div className="min-w-0">
          <h2 id="confirm-dialog-title" className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          <p id="confirm-dialog-body" className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">
            {body}
          </p>
        </div>
      </div>
      {details}
      <div className="mt-5 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-xl px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={cn(
            "rounded-xl px-4 py-2 text-[13px] font-medium",
            danger ? "bg-danger text-white hover:brightness-110" : "bg-accent text-white hover:brightness-110",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
