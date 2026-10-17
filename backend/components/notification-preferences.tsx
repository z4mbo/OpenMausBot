"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useWorkspace } from "./workspace-context";
import { ContentSkeleton } from "./content-skeleton";

export function NotificationPreferences({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const preferences = useQuery(api.preferences.notifications, { sessionToken, teamId: workspace._id });
  return preferences ? <PreferenceForm sessionToken={sessionToken} initial={preferences} /> : <ContentSkeleton rows={4} />;
}
function PreferenceForm({ sessionToken, initial }: { sessionToken: string; initial: FunctionReturnType<typeof api.preferences.notifications> }) {
  const workspace = useWorkspace();
  const [values, setValues] = useState(initial);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const save = useMutation(api.preferences.saveNotifications);
  return <form className="stack-form settings-section" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setNotice("");
    try { await save({ sessionToken, teamId: workspace._id, ...values }); setNotice("Notification preferences saved"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save preferences"); }
    finally { setBusy(false); }
  }}>
    {(["assignments", "comments", "mentions"] as const).map(key => <label className="notification-setting" key={key}><span>{key === "assignments" ? "New assignments" : key === "comments" ? "Issue comments" : "Chat mentions"}</span><input type="checkbox" role="switch" checked={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.checked }))} /></label>)}
    <h4>Quiet hours</h4>
    <div className="feature-form-pair"><label>Mute sounds from<input type="time" value={values.quietStart} onChange={e => setValues(current => ({ ...current, quietStart: e.target.value }))} /></label><label>Until<input type="time" value={values.quietEnd} onChange={e => setValues(current => ({ ...current, quietEnd: e.target.value }))} /></label></div>
    <label>Time zone<input value={values.timeZone} onChange={e => setValues(current => ({ ...current, timeZone: e.target.value }))} placeholder="Europe/Rome" /></label>
    <div className="row gap"><button type="button" className="ghost-button compact" onClick={() => setValues(current => ({ ...current, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }))}>Use device time zone</button><button type="button" className="ghost-button compact" onClick={() => setValues(current => ({ ...current, quietStart: "", quietEnd: "" }))}>Clear quiet hours</button></div>
    <h4>Muted projects</h4><div className="muted-project-list">{projects?.map(project => <label className="notification-setting" key={project._id}><span>{project.name}</span><input type="checkbox" checked={values.mutedProjects.includes(project._id)} onChange={e => setValues(current => ({ ...current, mutedProjects: e.target.checked ? [...current.mutedProjects, project._id] : current.mutedProjects.filter(id => id !== project._id) }))} /></label>)}</div>
    {notice && <p className="notice" role="status">{notice}</p>}
    <button className="primary-button compact" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}Save preferences</button>
  </form>;
}
