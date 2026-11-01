"use client";
import { errorText } from "@/lib/error-text";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useWorkspace } from "./workspace-context";
import { ContentSkeleton } from "./content-skeleton";
import { FormStatus, SettingSwitch, type FormNotice } from "./settings-controls";
import { ProjectIcon } from "./project-icon";

export function NotificationPreferences({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const preferences = useQuery(api.preferences.notifications, { sessionToken, teamId: workspace._id });
  return preferences ? <PreferenceForm sessionToken={sessionToken} initial={preferences} /> : <ContentSkeleton rows={4} />;
}

type Preferences = FunctionReturnType<typeof api.preferences.notifications>;
const same = (a: Preferences, b: Preferences) => JSON.stringify(a) === JSON.stringify(b);

function PreferenceForm({ sessionToken, initial }: { sessionToken: string; initial: Preferences }) {
  const workspace = useWorkspace();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [notice, setNotice] = useState<FormNotice>(null);
  const [busy, setBusy] = useState(false);
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const save = useMutation(api.preferences.saveNotifications);
  const change = (patch: Partial<Preferences>) => { setNotice(null); setValues(current => ({ ...current, ...patch })); };
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <form className="settings-form notification-preferences" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setNotice(null);
    try { await save({ sessionToken, teamId: workspace._id, ...values }); setSaved(values); setNotice({ tone: "success", text: "Preferences saved" }); }
    catch (error) { setNotice({ tone: "danger", text: errorText(error, "Could not save preferences") }); }
    finally { setBusy(false); }
  }}>
    <section className="settings-group">
      <h4>Notify me about</h4>
      <SettingSwitch label="New assignments" checked={values.assignments} onChange={assignments => change({ assignments })} />
      <SettingSwitch label="Comments on my issues" checked={values.comments} onChange={comments => change({ comments })} />
      <SettingSwitch label="Mentions" checked={values.mentions} onChange={mentions => change({ mentions })} />
    </section>
    <section className="settings-group">
      <h4>Quiet hours</h4>
      <div className="settings-field-pair"><label>From<input type="time" value={values.quietStart} onChange={e => change({ quietStart: e.target.value })} /></label><label>Until<input type="time" value={values.quietEnd} onChange={e => change({ quietEnd: e.target.value })} /></label></div>
      <label>Time zone<span className="copy-field"><input value={values.timeZone} onChange={e => change({ timeZone: e.target.value })} placeholder={deviceZone} />{values.timeZone !== deviceZone && <button type="button" className="ghost-button compact" onClick={() => change({ timeZone: deviceZone })}>Use {deviceZone}</button>}</span></label>
      {(values.quietStart || values.quietEnd) && <button type="button" className="text-button" onClick={() => change({ quietStart: "", quietEnd: "" })}>Clear quiet hours</button>}
    </section>
    {!!projects?.length && <section className="settings-group">
      <h4>Muted projects</h4>
      <div className="muted-project-list">{projects.map(project => <SettingSwitch key={project._id} label={<><ProjectIcon project={project} size={14} />{project.name}</>} checked={values.mutedProjects.includes(project._id)} onChange={muted => change({ mutedProjects: muted ? [...values.mutedProjects, project._id] : values.mutedProjects.filter(id => id !== project._id) })} />)}</div>
    </section>}
    <FormStatus notice={notice} />
    <div className="settings-actions"><button className="primary-button compact" disabled={busy || same(values, saved)}>{busy && <Loader2 className="spin" size={14} />}Save</button></div>
  </form>;
}
