"use client";
import type { ReactNode } from "react";
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

export { ConfirmButton } from "./confirm-button";
