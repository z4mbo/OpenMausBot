"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Loader2, Trash2 } from "lucide-react";

/**
 * The one two-step destructive button (project and workspace settings, assets, vault): the first press arms it (it
 * widens into a red confirm label), the second confirms. It disarms after a few seconds, on Escape or when focus
 * leaves, so a stray tap never deletes anything. Without `text` it is an icon button labelled by `label`.
 */
export function ConfirmButton({ label, text, confirmLabel = "Delete", onConfirm, disabled, icon, className = "icon-button" }: { label: string; text?: string; confirmLabel?: string; onConfirm: () => Promise<unknown> | unknown; disabled?: boolean; icon?: ReactNode; className?: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const disarm = () => { window.clearTimeout(timer.current); setArmed(false); };
  return <button
    type="button"
    className={clsx("confirm-button", text ? "with-text" : "icon-only", armed && "armed", className)}
    aria-label={armed ? `Confirm: ${label}` : text ? undefined : label}
    title={armed || text ? undefined : label}
    disabled={disabled || busy}
    onBlur={disarm}
    onKeyDown={event => { if (event.key === "Escape" && armed) { event.stopPropagation(); disarm(); } }}
    onClick={async event => {
      event.stopPropagation();
      if (!armed) { setArmed(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setArmed(false), 3500); return; }
      disarm(); setBusy(true);
      try { await onConfirm(); } finally { setBusy(false); }
    }}
  >{busy ? <Loader2 className="spin" size={14} /> : icon ?? <Trash2 size={14} />}{text ? <span>{armed ? confirmLabel : text}</span> : <span className="confirm-button-text" aria-hidden={!armed}>{confirmLabel}</span>}</button>;
}
