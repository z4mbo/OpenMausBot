import { useState, type FormEvent } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { cloudMutation } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { SHIP_PROVIDERS, SHIP_PROVIDER_LABEL, SHIP_TARGET_FIELDS, SHIP_LIMITS, type ShipProvider, type ShipTarget } from "../../../shared/origin-ship";
import { Select } from "../Select";
import { Field, Modal, Notice, ghostButton, inputClass, primaryButton } from "../origin-pages/ui";
import { errorText } from "../origin-pages/repo-url";

type Draft = { provider: ShipProvider; name: string; ref: string; account: string; branch: string; siteUrl: string };

const blank = (branch: string): Draft => ({ provider: "vercel", name: "Production", ref: "", account: "", branch, siteUrl: "" });
const fromTarget = (target: ShipTarget): Draft => ({ provider: target.provider, name: target.name, ref: target.ref, account: target.account ?? "", branch: target.branch, siteUrl: target.siteUrl ?? "" });

export function TargetDialog({ projectId, target, defaultBranch, onClose }: { projectId: string; target: ShipTarget | null; defaultBranch: string; onClose(): void }) {
  const [draft, setDraft] = useState<Draft>(() => (target ? fromTarget(target) : blank(defaultBranch)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fields = SHIP_TARGET_FIELDS[draft.provider];
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const ready = draft.name.trim() && draft.ref.trim() && draft.branch.trim() && (!fields.account?.required || draft.account.trim());

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await cloudMutation("ship:saveTarget", {
        projectId, ...(target ? { targetId: target._id } : {}), provider: draft.provider, name: draft.name, ref: draft.ref, branch: draft.branch,
        ...(fields.account ? { account: draft.account } : {}), siteUrl: draft.siteUrl,
      });
      onClose();
    } catch (cause) {
      setError(errorText(cause, "Could not save the target"));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!target || !window.confirm(`Remove ${target.name}? Its deployments stay on ${SHIP_PROVIDER_LABEL[target.provider]}.`)) return;
    setBusy(true);
    try {
      await cloudMutation("ship:removeTarget", { projectId, targetId: target._id });
      onClose();
    } catch (cause) {
      setError(errorText(cause, "Could not remove the target"));
      setBusy(false);
    }
  };

  return (
    <Modal title={target ? `Edit ${target.name}` : "Add a deploy target"} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <Field label="Provider">
          <Select value={draft.provider} disabled={Boolean(target)} onChange={(event) => set({ provider: event.target.value as ShipProvider, account: "" })} aria-label="Provider">
            {SHIP_PROVIDERS.map((provider) => <option key={provider} value={provider}>{SHIP_PROVIDER_LABEL[provider]}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} value={draft.name} maxLength={SHIP_LIMITS.name} onChange={(event) => set({ name: event.target.value })} placeholder="Production" />
          </Field>
          <Field label="Branch">
            <input className={cn(inputClass, "font-mono")} value={draft.branch} maxLength={SHIP_LIMITS.branch} onChange={(event) => set({ branch: event.target.value })} placeholder="main" />
          </Field>
        </div>
        <Field label={fields.ref}>
          <input className={cn(inputClass, "font-mono")} value={draft.ref} maxLength={SHIP_LIMITS.ref} onChange={(event) => set({ ref: event.target.value })} placeholder={fields.refPlaceholder} />
        </Field>
        {fields.account && (
          <Field label={fields.account.required ? fields.account.label : `${fields.account.label} (optional)`}>
            <input className={cn(inputClass, "font-mono")} value={draft.account} maxLength={SHIP_LIMITS.account} onChange={(event) => set({ account: event.target.value })} placeholder={fields.account.placeholder} />
          </Field>
        )}
        <Field label={draft.provider === "github-actions" ? "Site address" : "Site address (optional)"}>
          <input className={inputClass} type="url" value={draft.siteUrl} maxLength={SHIP_LIMITS.url} onChange={(event) => set({ siteUrl: event.target.value })} placeholder="https://example.com" />
        </Field>
        <p className="text-[12px] leading-snug text-ink-tertiary">
          {draft.provider === "github-actions"
            ? "Runs the workflow with workflow_dispatch through the project's GitHub connection. The Origin GitHub App needs Actions: write."
            : `Each member deploys with their own ${SHIP_PROVIDER_LABEL[draft.provider]} token from Settings > Integrations; it never leaves their computer.`}
        </p>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex items-center gap-2 pt-1">
          {target && <button type="button" className={ghostButton} disabled={busy} onClick={() => void remove()}><Trash2 size={14} />Remove</button>}
          <button type="submit" className={cn(primaryButton, "ml-auto")} disabled={!ready || busy}>{busy && <Loader2 size={14} className="animate-spin" />}{target ? "Save" : "Add target"}</button>
        </div>
      </form>
    </Modal>
  );
}
