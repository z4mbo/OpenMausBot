import { useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import type { CallAgentEngine } from "@/lib/call-agent";
import { Card, SettingRow, Switch } from "./SettingsPrimitives";
import { Select } from "./Select";

type Settings = {
  transcription: { engine: CallAgentEngine; baseUrl: string; model: string };
  summarizer: { instanceId: string; model: string };
  keepTranscript: boolean;
};
type Loaded = { settings: Settings; keys: { groq: boolean; openai: boolean }; defaults: Record<Exclude<CallAgentEngine, "browser">, string> };

const ENGINES: { id: CallAgentEngine; label: string }[] = [
  { id: "local", label: "Local server (Whisper, OpenAI-compatible)" },
  { id: "groq", label: "Groq Whisper" },
  { id: "openai", label: "OpenAI" },
  { id: "browser", label: "Browser speech recognition" },
];

const field = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/** How an agent added to a member call hears it and writes its summary. Audio is never stored either way. */
export function CallAgentSettings() {
  const { state } = useStore();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    api<Loaded>("/api/origin-call-agent/settings").then((next) => { if (live) { setLoaded(next); setDraft(next.settings); } }, () => { if (live) setError("Only an admin can change call agent settings."); });
    return () => { live = false; };
  }, []);

  if (!draft || !loaded) return error ? <Card title="Agents in calls" subtitle={error} /> : null;

  const save = async (next: Settings) => {
    setDraft(next);
    setSaved(false);
    setError("");
    try {
      const result = await api<Loaded>("/api/origin-call-agent/settings", { method: "PUT", body: JSON.stringify(next) });
      setLoaded(result);
      setDraft(result.settings);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const engine = draft.transcription.engine;
  const missingKey = (engine === "groq" && !loaded.keys.groq) || (engine === "openai" && !loaded.keys.openai);
  const instances = state.instances.filter((instance) => instance.snapshot.state === "available");

  return (
    <Card title="Agents in calls" subtitle="A chief added to a call transcribes it, answers when called by name, and posts a summary in its chat when it leaves. Audio is never stored.">
      <div className="mt-3 flex flex-col gap-3">
        <SettingRow title="Speech to text" subtitle={missingKey ? `Add a ${engine === "groq" ? "Groq" : "OpenAI"} key under Connections first.` : engine === "browser" ? "Each person's own browser transcribes; not available in every app." : undefined}>
          <Select size="sm" aria-label="Speech to text engine" value={engine}
            onChange={(event) => void save({ ...draft, transcription: { ...draft.transcription, engine: event.target.value as CallAgentEngine, model: "" } })}>
            {ENGINES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        </SettingRow>
        {engine !== "browser" && (
          <div className={cn("grid gap-2", engine === "local" && "sm:grid-cols-2")}>
            {engine === "local" && (
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">Server URL
                <input className={field} value={draft.transcription.baseUrl} onChange={(event) => setDraft({ ...draft, transcription: { ...draft.transcription, baseUrl: event.target.value } })}
                  onBlur={() => void save(draft)} spellCheck={false} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">Model
              <input className={field} value={draft.transcription.model} placeholder={loaded.defaults[engine]} spellCheck={false}
                onChange={(event) => setDraft({ ...draft, transcription: { ...draft.transcription, model: event.target.value } })} onBlur={() => void save(draft)} />
            </label>
          </div>
        )}
        <SettingRow title="Summary model" subtitle="Automatic uses the workspace helper model, else the chief's engine at its quickest model.">
          <Select size="sm" aria-label="Summary engine" value={draft.summarizer.instanceId}
            onChange={(event) => void save({ ...draft, summarizer: { instanceId: event.target.value, model: "" } })}>
            <option value="">Automatic</option>
            {instances.map((instance) => <option key={instance.instanceId} value={instance.instanceId}>{instance.displayName}</option>)}
          </Select>
        </SettingRow>
        {draft.summarizer.instanceId && (
          <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">Summary model id
            <input className={field} value={draft.summarizer.model} placeholder="The engine's quickest model" spellCheck={false}
              onChange={(event) => setDraft({ ...draft, summarizer: { ...draft.summarizer, model: event.target.value } })} onBlur={() => void save(draft)} />
          </label>
        )}
        <SettingRow title="Keep transcripts" subtitle="Off: the transcript is deleted once summarised. People in a call can change this for their call.">
          <Switch checked={draft.keepTranscript} aria-label="Keep transcripts" onClick={() => void save({ ...draft, keepTranscript: !draft.keepTranscript })} />
        </SettingRow>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        {saved && !error && <p className="text-[12px] text-ink-tertiary" role="status">Saved</p>}
      </div>
    </Card>
  );
}
