"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";

export type FormNotice = { tone: "success" | "danger"; text: string } | null;

/** Result line under a settings form: green with a check on success, red on failure. */
export function FormStatus({ notice }: { notice: FormNotice }) {
  return notice ? <p className={`notice ${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>{notice.tone === "success" ? <Check size={14} /> : <CircleAlert size={14} />}{notice.text}</p> : null;
}

/** A switch that looks the same everywhere in settings. */
export function SettingSwitch({ label, checked, disabled, onChange }: { label: ReactNode; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-switch"><span>{label}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /></label>;
}

/** Destructive button that asks once inline ("Remove?") instead of a browser confirm. */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, icon, className = "icon-button" }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean; icon: ReactNode; className?: string }) {
  const [armed, setArmed] = useState(false);
  const iconOnly = className.includes("icon-button");
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return armed
    ? <button type="button" className="ghost-button compact danger confirm-armed" disabled={disabled} onBlur={() => setArmed(false)} onClick={() => { setArmed(false); onConfirm(); }} autoFocus>{confirmLabel}</button>
    : <button type="button" className={className} disabled={disabled} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} onClick={() => setArmed(true)}>{icon}</button>;
}
