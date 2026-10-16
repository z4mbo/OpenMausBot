import { useRef, useState } from "react";
import { Crown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { setProjectIcon, useProjectIcon } from "@/lib/origin-project-icons";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { botAvatarUrlFromStoredPath } from "../../shared/bot-avatar";

/** The mark beside a project's name: its favicon when one is set, else the crown. */
export function ProjectMark({ botId, size = 13, className }: { botId: string; size?: number; className?: string }) {
  const iconUrl = useProjectIcon(botId);
  const label = t("sidebar.bot.chiefOfStaff");
  if (iconUrl) return <img src={iconUrl} alt={label} width={size} height={size} data-testid="chief-crown" className={cn("shrink-0 rounded-sm object-cover", className)} />;
  return (
    <Crown size={size} strokeWidth={2.25} className={cn("shrink-0 text-accent", className)} role="img" aria-label={label} data-testid="chief-crown">
      <title>{label}</title>
    </Crown>
  );
}

export function ProjectIconField({ botId }: { botId: string }) {
  const iconUrl = useProjectIcon(botId);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (next: string | null) => {
    setSaving(true); setError("");
    try { await setProjectIcon(botId, next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const upload = async (file: File) => {
    const stored = await imageAttachmentFromFile(file);
    const url = stored && botAvatarUrlFromStoredPath(stored.path);
    if (!url) { setError("Could not store the image"); return; }
    await save(url);
  };
  return (
    <div>
      <div className="mb-1.5 text-[13px] text-ink-secondary">Project icon</div>
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-inset"><ProjectMark botId={botId} size={20} /></span>
        <button type="button" disabled={saving} onClick={() => input.current?.click()}
          className="rounded-lg bg-raised px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50">Upload image</button>
        {iconUrl && <button type="button" disabled={saving} onClick={() => void save(null)}
          className="rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">Use crown</button>}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      </div>
      <p className="mt-1.5 text-[12px] text-ink-secondary">Shown beside the project's name. PNG, JPEG, GIF or WebP.</p>
      {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
