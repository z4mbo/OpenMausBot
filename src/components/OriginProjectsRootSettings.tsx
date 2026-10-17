import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { getProjectsRoot, rootChoices, setProjectsRoot, type ProjectsRoot } from "@/lib/origin-projects-root";
import { Card } from "./SettingsPrimitives";
import { Select } from "./Select";

const PICK = "__pick__";

export function OriginProjectsRootSettings() {
  const [answer, setAnswer] = useState<ProjectsRoot | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getProjectsRoot().then((value) => { if (alive) setAnswer(value); }, () => undefined);
    return () => { alive = false; };
  }, []);

  if (!answer) return null;
  const pick = window.ogb?.pickFolder;

  const save = async (root: string) => {
    setSaving(true);
    setError("");
    try {
      setAnswer(await setProjectsRoot(root));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const choose = async (value: string) => {
    if (value !== PICK) return save(value);
    const chosen = await pick?.(answer.root);
    if (!chosen) return;
    setCustom(chosen);
    await save(chosen);
  };

  return (
    <Card title="Origin projects folder" subtitle="Each Origin project gets its own folder here, and its agents work in it: they clone the project's repository into it and run it from there.">
      <div className="mt-3 flex flex-col gap-2">
        <Select size="sm" className="w-full max-w-[420px]" aria-label="Origin projects folder" value={answer.root} disabled={saving}
          onChange={(event) => void choose(event.target.value)}>
          {rootChoices(answer, custom).map((choice) => (
            <option key={choice.path} value={choice.path}>{`${choice.label} · ${choice.path}`}</option>
          ))}
          {pick && <option value={PICK}>Choose another folder…</option>}
        </Select>
        <p className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
          <FolderOpen size={12} />
          {answer.chosen ? answer.root : `${answer.root} (default)`}
        </p>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
