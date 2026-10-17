import { useEffect, useRef, useState } from "react";
import { Check, FolderOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  initialRoot,
  parseProjectsRoot,
  PROJECTS_ROOT_PATH,
  rootChoices,
  rootNeedsSaving,
  type ProjectsRoot,
} from "@/lib/origin-projects-root";
import { api, ApiError } from "@/state/store";
import { PrimaryButton, staggerIndex, type BeatProps } from "./shared";

function ChoiceRow({ label, path, selected, onSelect }: { label: string; path: string | null; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-150",
        selected ? "bg-raised/60" : "hover:bg-raised/40",
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
          selected ? "border-accent bg-accent text-white" : "border-hairline",
        )}
      >
        {selected && <Check size={10} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        {path && <span className="block truncate text-[11.5px] text-ink-secondary">{path}</span>}
      </span>
    </button>
  );
}

export function ProjectsBeat({ onNext, setMascot }: BeatProps) {
  const [answer, setAnswer] = useState<ProjectsRoot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setMascot("curious");
    api(PROJECTS_ROOT_PATH, { timeoutMs: 10_000 })
      .then((body) => {
        if (!alive.current) return;
        const parsed = parseProjectsRoot(body);
        setAnswer(parsed);
        setSelected((current) => current ?? initialRoot(parsed));
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choices = rootChoices(answer, custom);
  const pick = window.ogb?.pickFolder;

  const browse = async () => {
    const chosen = await pick?.(selected ?? answer?.root);
    if (!chosen || !alive.current) return;
    setCustom(chosen);
    setSelected(chosen);
    setError(null);
  };

  const finish = async () => {
    if (saving) return;
    if (error || !rootNeedsSaving(answer, selected)) return onNext();
    setSaving(true);
    try {
      const body = await api(PROJECTS_ROOT_PATH, { method: "PUT", body: JSON.stringify({ root: selected }), timeoutMs: 15_000 });
      if (alive.current) setAnswer(parseProjectsRoot(body));
      onNext();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) return onNext();
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const select = (path: string | null) => {
    setSelected(path);
    setError(null);
  };

  return (
    <div className="flex flex-col">
      <p className="animate-rise mt-1 text-[13.5px] text-ink-secondary">{t("onboarding.projects.intro")}</p>
      <div
        role="radiogroup"
        aria-label={t("onboarding.projects.title")}
        className="animate-rise mt-4 divide-y divide-hairline/40 overflow-hidden rounded-xl border border-hairline/40 bg-card"
        style={staggerIndex(1)}
      >
        {choices.length ? (
          choices.map((choice) => (
            <ChoiceRow
              key={choice.path}
              label={choice.label}
              path={choice.path}
              selected={selected === choice.path}
              onSelect={() => select(choice.path)}
            />
          ))
        ) : (
          <ChoiceRow label={t("onboarding.projects.documents")} path={null} selected={selected === null} onSelect={() => select(null)} />
        )}
      </div>
      {pick && (
        <button
          type="button"
          onClick={() => void browse()}
          className="animate-rise mt-2.5 flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12.5px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
          style={staggerIndex(2)}
        >
          <FolderOpen size={13} />
          {t("onboarding.projects.choose")}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {t("onboarding.projects.saveError", { reason: error })}
        </p>
      )}
      <PrimaryButton onClick={() => void finish()} disabled={saving} className="mt-5">
        {t("onboarding.continue")}
      </PrimaryButton>
    </div>
  );
}
