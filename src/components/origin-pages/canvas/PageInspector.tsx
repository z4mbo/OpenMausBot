import { useState } from "react";
import { isLinkAddress, type CanvasNode } from "../../../../shared/canvas-scene";
import { cn } from "@/lib/cn";
import { Section, field } from "./controls";

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
