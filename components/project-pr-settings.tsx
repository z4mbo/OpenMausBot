"use client";
import { errorText } from "@/lib/error-text";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type Settings = { mode: "issue" | "pull_request"; review: string; done: string };

/** How issues map to GitHub. Each choice saves as it is made; draft pull requests wait for a review column. */
export function ProjectPRSettings({ project, sessionToken }: { project: Doc<"projects">; sessionToken: string }) {
  const columns = useQuery(api.taskPRs.columns, { sessionToken, projectId: project._id });
  const configure = useMutation(api.taskPRs.configure);
  const [settings, setSettings] = useState<Settings>({
    mode: project.githubTaskMode ?? "issue",
    review: project.githubReviewColumnId === undefined ? "" : project.githubReviewColumnId ?? "none",
    done: project.githubDoneColumnId ?? "auto",
  });
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const latest = useRef(0);
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);
  const change = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next); setError("");
    if (next.mode === "pull_request" && !next.review) { setState("idle"); return; }
    const call = ++latest.current;
    setState("saving");
    try {
      await configure({ sessionToken, projectId: project._id, mode: next.mode, reviewColumnId: !next.review ? undefined : next.review === "none" ? null : next.review as Id<"columns">, doneColumnId: next.done === "auto" ? undefined : next.done as Id<"columns"> });
      if (call !== latest.current) return;
      setState("saved");
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setState("idle"), 1600);
    } catch (failure) { if (call === latest.current) { setState("idle"); setError(errorText(failure, "Could not save settings")); } }
  };
  return <section className="repo-settings-section">
    <h3>Issues on GitHub{state === "saving" ? <Loader2 className="spin repo-settings-state" size={13} aria-label="Saving" /> : state === "saved" ? <span className="repo-settings-saved" role="status"><Check size={13} />Saved</span> : null}</h3>
    <label>Create issues as<select value={settings.mode} disabled={!columns} onChange={e => void change({ mode: e.target.value as Settings["mode"] })}><option value="issue">GitHub issues</option><option value="pull_request">Draft pull requests</option></select></label>
    {settings.mode === "pull_request" && <label>Review column<select value={settings.review} disabled={!columns} aria-invalid={!settings.review || undefined} onChange={e => void change({ review: e.target.value })}><option value="" disabled>Choose a column</option><option value="none">Keep current column</option>{columns?.filter(c => !c.isDone).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
    <label>Column on merge<select value={settings.done} disabled={!columns} onChange={e => void change({ done: e.target.value })}><option value="auto">Done</option>{columns?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
    {error && <p className="notice danger" role="alert">{error}</p>}
  </section>;
}
