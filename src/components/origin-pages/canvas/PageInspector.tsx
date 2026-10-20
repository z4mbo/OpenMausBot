import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { LEAD_FIELDS, isLinkAddress, leadForm, type CanvasNode, type LeadField } from "../../../../shared/canvas-scene";
import { DEFAULT_LEAD_FORM, LEAD_FIELD_LABELS, leadFormHeight } from "../../../../shared/canvas-page";
import { cn } from "@/lib/cn";
import { ColorField, Section, field, iconToggle } from "./controls";

type Update = (patch: Partial<CanvasNode>) => void;

function linkAddress(text: string): string | null {
  const value = text.trim();
  if (!value) return "";
  const address = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : value.includes("@") && !value.includes("/") ? `mailto:${value}` : `https://${value}`;
  return isLinkAddress(address) ? address : null;
}

export function LinkSection({ node, disabled, update }: { node: CanvasNode; disabled: boolean; update: Update }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  if (node.type === "line" || node.type === "arrow" || node.type === "path" || node.type === "group" || node.leadForm) return null;
  const commit = (text: string) => {
    setDraft(null);
    const address = linkAddress(text);
    setInvalid(address === null);
    if (address === null || address === (node.link ?? "")) return;
    update({ link: address || undefined });
  };
  return (
    <Section title="Link">
      <input className={cn(field, invalid && "border-danger/70")} aria-label="Link address" placeholder="https://… or an email" disabled={disabled} inputMode="url"
        value={draft ?? node.link ?? ""} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(null); setInvalid(false); } }} />
      {invalid && <p role="alert" className="text-[11.5px] text-danger">Use a web address or an email</p>}
    </Section>
  );
}

export function LeadFormSection({ node, readOnly, disabled, update }: { node: CanvasNode; readOnly: boolean; disabled: boolean; update: Update }) {
  const form = node.leadForm;
  const [button, setButton] = useState<string | null>(null);
  const change = (patch: Partial<typeof DEFAULT_LEAD_FORM>) => {
    const next = leadForm({ ...(form ?? DEFAULT_LEAD_FORM), ...patch })!;
    update({ leadForm: next, layout: undefined, height: leadFormHeight(next) });
  };
  const toggle = (name: LeadField) => form && change({ fields: form.fields.includes(name) ? form.fields.filter((item) => item !== name) : [...form.fields, name] });
  return (
    <Section title="Lead form" action={!readOnly && (
      <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label={form ? "Remove lead form" : "Make this a lead form"} title={form ? "Remove lead form" : "Make this a lead form"} disabled={disabled}
        onClick={() => (form ? update({ leadForm: undefined }) : change({}))}>{form ? <Minus size={13} /> : <Plus size={13} />}</button>
    )}>
      {form && (
        <>
          <div role="group" aria-label="Form fields" className="grid grid-cols-2 gap-1">
            {LEAD_FIELDS.map((name) => (
              <button key={name} type="button" aria-pressed={form.fields.includes(name)} disabled={disabled} onClick={() => toggle(name)}
                className={cn(iconToggle, "text-[11.5px]", form.fields.includes(name) && "bg-raised text-ink")}>{LEAD_FIELD_LABELS[name]}</button>
            ))}
          </div>
          <input className={field} aria-label="Button label" placeholder="Button label" maxLength={40} disabled={disabled} value={button ?? form.button}
            onChange={(event) => setButton(event.target.value)}
            onBlur={(event) => { setButton(null); if (event.target.value.trim() && event.target.value.trim() !== form.button) change({ button: event.target.value }); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setButton(null); }} />
          <ColorField label="Button" value={form.accent} disabled={disabled} onPreview={() => {}} onCommit={(accent) => change({ accent })}
            onRemove={form.accent ? () => change({ accent: null }) : undefined} />
          <p className="text-[11.5px] leading-snug text-ink-tertiary">Signups on the published page land in Pipeline.</p>
        </>
      )}
    </Section>
  );
}
