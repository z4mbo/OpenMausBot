"use client";
import { errorText } from "@/lib/error-text";
import { localAppOrigin } from "@/lib/client-api";
import { focusQuietly } from "@/lib/initial-focus";
import { displayName, formatDate, formatDateTime } from "@/lib/format";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Bell, Bot, Check, ChevronRight, CircleAlert, Copy, Link, Loader2, LogOut, Plug, Settings2, Shield, Trash2, User, UserPlus, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Dialog } from "./dialog";
import { useMemberProfile, useWorkspace } from "./workspace-context";
import { IntegrationSettings } from "./integration-settings";
import { AgentSettings } from "./agent-settings";
import { UserAvatar } from "./user-avatar";
import { ContentSkeleton } from "./content-skeleton";
import { NotificationPreferences } from "./notification-preferences";
import { ConfirmButton, FormStatus, SettingSwitch, type FormNotice } from "./settings-controls";

type Section = "profile" | "security" | "notifications" | "workspace" | "members" | "integrations" | "agents";
const sections: { id: Section; label: string; icon: typeof User; group: "account" | "workspace" }[] = [
  { id: "profile", label: "My profile", icon: User, group: "account" },
  { id: "security", label: "Security", icon: Shield, group: "account" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "account" },
  { id: "workspace", label: "Workspace", icon: Settings2, group: "workspace" },
  { id: "members", label: "Members & invites", icon: Users, group: "workspace" },
  { id: "integrations", label: "Integrations", icon: Plug, group: "workspace" },
  { id: "agents", label: "Agents", icon: Bot, group: "workspace" },
];

export function WorkspaceSettings({ sessionToken, profile, security, sound, onToggleSound, onClose, onLogout }: { sessionToken: string; profile: ReactNode; security: ReactNode; sound: boolean; onToggleSound: () => void; onClose: () => void; onLogout: () => void }) {
  const workspace = useWorkspace();
  const [tab, setTab] = useState<Section>("profile");
  // Phones show the section list first and drill into one section; desktop shows both side by side.
  const [drilled, setDrilled] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const open = (section: Section) => { setTab(section); setDrilled(true); body.current?.scrollTo({ top: 0 }); };
  const current = sections.find(section => section.id === tab)!;
  useEffect(() => {
    if (!drilled || !window.matchMedia("(max-width: 760px)").matches) return;
    focusQuietly(body.current?.querySelector<HTMLElement>(".settings-back"));
  }, [drilled, tab]);
  const back = () => { setDrilled(false); requestAnimationFrame(() => focusQuietly(navRef.current?.querySelector<HTMLElement>(`[data-section="${tab}"]`))); };
  return <Dialog title="Settings" className="settings-dialog" onClose={onClose}>
    <div className="settings-layout" data-view={drilled ? "section" : "list"}>
      <nav ref={navRef} className="settings-nav" aria-label="Settings sections">
        {(["account", "workspace"] as const).map(group => <div className="settings-nav-group" key={group} role="group" aria-labelledby={`settings-group-${group}`}>
          <span id={`settings-group-${group}`}>{group === "account" ? "Account" : workspace.name}</span>
          {sections.filter(section => section.group === group).map(({ id, label, icon: Icon }) => <button key={id} type="button" data-section={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => open(id)}><Icon size={15} /><span>{label}</span><ChevronRight size={15} className="settings-nav-chevron" /></button>)}
        </div>)}
        <button type="button" className="settings-logout" onClick={onLogout}><LogOut size={15} /><span>Sign out</span></button>
      </nav>
      <div className="settings-body" ref={body}>
        <header className="settings-section-head">
          <button type="button" className="icon-button settings-back" aria-label="Back to settings" onClick={back}><ArrowLeft size={18} /></button>
          <h3>{current.label}</h3>
        </header>
        {tab === "profile" && profile}
        {tab === "security" && <><div className="settings-group">{security}</div><SessionSettings sessionToken={sessionToken} /></>}
        {tab === "notifications" && <><div className="settings-group"><SettingSwitch label="Notification sound" checked={sound} onChange={onToggleSound} /></div><NotificationPreferences sessionToken={sessionToken} /></>}
        {tab === "workspace" && <><WorkspaceGeneral sessionToken={sessionToken} /><LeaveWorkspace sessionToken={sessionToken} /><DeleteWorkspace sessionToken={sessionToken} /></>}
        {tab === "members" && <WorkspaceMembers sessionToken={sessionToken} beforeOpenProfile={onClose} />}
        {tab === "integrations" && <IntegrationSettings sessionToken={sessionToken} />}
        {tab === "agents" && <AgentSettings sessionToken={sessionToken} />}
      </div>
    </div>
  </Dialog>;
}

function SessionSettings({ sessionToken }: { sessionToken: string }) {
  const revoke = useMutation(api.auth.revokeOtherSessions);
  const [notice, setNotice] = useState<FormNotice>(null);
  const [busy, setBusy] = useState(false);
  return <section className="settings-group">
    <h4>Sessions</h4>
    <div className="setting-row"><span>Other devices</span><button type="button" className="ghost-button compact" disabled={busy} onClick={async () => {
      setBusy(true); setNotice(null);
      try { await revoke({ sessionToken }); setNotice({ tone: "success", text: "Signed out on all other devices" }); }
      catch (error) { setNotice({ tone: "danger", text: errorText(error, "Could not sign out other devices") }); }
      finally { setBusy(false); }
    }}>{busy && <Loader2 size={14} className="spin" />}Sign out other devices</button></div>
    <FormStatus notice={notice} />
  </section>;
}

function WorkspaceGeneral({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [notice, setNotice] = useState<FormNotice>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const update = useMutation(api.workspaces.update);
  const admin = ["owner", "admin"].includes(workspace.role);
  const url = `${typeof window !== "undefined" ? localAppOrigin() : ""}/${workspace.slug}`;
  return <form className="settings-form" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setNotice(null);
    try { await update({ sessionToken, teamId: workspace._id, name }); setNotice({ tone: "success", text: "Workspace updated" }); }
    catch (error) { setNotice({ tone: "danger", text: errorText(error, "Could not save") }); }
    finally { setBusy(false); }
  }}>
    <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={60} disabled={!admin} /></label>
    <label>URL<span className="copy-field"><input value={url} readOnly onFocus={event => event.currentTarget.select()} /><button type="button" className="icon-button" aria-label="Copy workspace URL" title="Copy workspace URL" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* The field stays selectable. */ } }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></span></label>
    <FormStatus notice={notice} />
    {admin && <div className="settings-actions"><button className="primary-button compact" disabled={busy || !name.trim() || name.trim() === workspace.name}>{busy && <Loader2 size={14} className="spin" />}Save</button></div>}
  </form>;
}

function LeaveWorkspace({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const leave = useMutation(api.teams.leave);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (workspace.role === "owner") return null;
  return <section className="settings-group danger-zone leave-workspace">
    <div className="setting-row"><span>Leave {workspace.name}</span>{!confirming && <button className="ghost-button compact danger" onClick={() => setConfirming(true)}><LogOut size={14} />Leave workspace</button>}</div>
    {confirming && <div className="confirm-panel"><p>You will need a new invitation to return.</p><div className="settings-confirm-actions"><button className="ghost-button compact" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button className="primary-button compact danger" disabled={busy} onClick={async () => { setBusy(true); try { await leave({ sessionToken, teamId: workspace._id }); window.location.assign("/"); } catch (e) { setError(errorText(e, "Could not leave workspace")); setBusy(false); } }}>{busy ? <Loader2 size={14} className="spin" /> : <LogOut size={14} />}Leave workspace</button></div></div>}
    {error && <p className="notice danger" role="alert">{error}</p>}
  </section>;
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

function DeleteWorkspace({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const admin = ["owner", "admin"].includes(workspace.role);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const summary = useQuery(api.workspaces.deletionSummary, admin && confirming ? { sessionToken, teamId: workspace._id } : "skip");
  const remove = useMutation(api.workspaces.remove);
  if (!admin) return null;
  const matches = typed.trim() === workspace.name.trim();
  return <section className="settings-group danger-zone delete-workspace">
    <div className="setting-row"><span>Delete {workspace.name}</span>{!confirming && <button className="ghost-button compact danger" onClick={() => setConfirming(true)}><Trash2 size={14} />Delete workspace</button>}</div>
    {confirming && <form className="confirm-panel settings-form" onSubmit={async event => {
      event.preventDefault(); if (!matches || busy) return;
      setBusy(true); setError("");
      try { await remove({ sessionToken, teamId: workspace._id, confirmName: typed }); window.location.assign("/"); }
      catch (e) { setError(errorText(e, "Could not delete workspace")); setBusy(false); }
    }}>
      <p>Deletes {summary ? `${plural(summary.projectCount, "project")}, ${plural(summary.openIssueCount, "open issue")}, chat and files` : "all projects, issues, chat and files"} for {summary ? plural(summary.memberCount, "member") : "everyone"}. GitHub repositories are kept. This cannot be undone.</p>
      <label>Type {workspace.name} to confirm<input value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} autoFocus /></label>
      {error && <p className="notice danger" role="alert">{error}</p>}
      <div className="settings-confirm-actions"><button type="button" className="ghost-button compact" disabled={busy} onClick={() => { setConfirming(false); setTyped(""); setError(""); }}>Cancel</button><button className="primary-button compact danger" disabled={!matches || busy}>{busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}Delete workspace</button></div>
    </form>}
  </section>;
}

const roleLabel = (role: string) => role[0].toUpperCase() + role.slice(1);

function WorkspaceMembers({ sessionToken, beforeOpenProfile }: { sessionToken: string; beforeOpenProfile?: () => void }) {
  const workspace = useWorkspace();
  const openMember = useMemberProfile();
  const admin = ["owner", "admin"].includes(workspace.role);
  const members = useQuery(api.workspaces.members, { sessionToken, teamId: workspace._id });
  const invitations = useQuery(api.workspaces.invitations, admin ? { sessionToken, teamId: workspace._id } : "skip") as Doc<"workspaceInvites">[] | undefined;
  const createInvite = useMutation(api.workspaces.createInvite);
  const revokeInvite = useMutation(api.workspaces.revokeInvite);
  const removeMember = useMutation(api.teams.removeMember);
  const updateRole = useMutation(api.teams.updateRole);
  const [role, setRole] = useState<"admin" | "member" | "viewer">("member");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const attempt = async (fn: () => Promise<unknown>) => { setBusy(true); setNotice(""); try { await fn(); } catch (error) { setNotice(errorText(error, "Action failed")); } finally { setBusy(false); } };
  const copy = async (value: string, key: string) => { try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(current => current === key ? "" : current), 1600); } catch { setNotice("Clipboard unavailable. Select and copy the invitation link."); } };
  const workspaceInvites = invitations?.filter(invite => !invite.projectId);
  const creator = (id: string) => { const member = members?.find(member => member.userId === id); return member ? displayName(member) : "a former member"; };
  return <>
    {admin && <section className="settings-group">
      <form className="invite-link-form" onSubmit={event => { event.preventDefault(); void attempt(async () => { const result = await createInvite({ sessionToken, teamId: workspace._id, role }); setLink(`${localAppOrigin()}/join/${result.token}`); }); }}>
        <label>Invite as<select value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></label>
        <button className="primary-button compact" disabled={busy}>{busy ? <Loader2 className="spin" size={14} /> : <Link size={14} />}Create invite link</button>
      </form>
      {link && <div className="copy-field invite-link"><input aria-label="Invitation link" value={link} readOnly onFocus={event => event.currentTarget.select()} /><button type="button" className="icon-button" title="Copy invite link" aria-label="Copy invite link" onClick={() => copy(link, "new")}>{copied === "new" ? <Check size={15} /> : <Copy size={15} />}</button></div>}
    </section>}
    {notice && <p className="notice danger" role="alert">{notice}</p>}
    <section className="settings-group">
      <h4>Members{members ? <span className="settings-count">{members.length}</span> : null}</h4>
      <div className="settings-list">{members === undefined && <ContentSkeleton kind="chat" rows={4} label="Loading members" />}{members?.map(member => <div className="settings-list-row workspace-member" key={member._id}>
        <button className="member-profile-trigger" onClick={() => { beforeOpenProfile?.(); openMember(member.email); }} aria-label={`View ${displayName(member)} profile`}><UserAvatar user={member} /><span><strong>{displayName(member)}</strong><small>{member.username ? `@${member.username} · ` : ""}{member.email}</small></span></button>
        {admin && member.role !== "owner" ? <><select aria-label={`Role for ${displayName(member)}`} value={member.role} disabled={busy} onChange={event => attempt(() => updateRole({ sessionToken, teamId: workspace._id, memberId: member._id, role: event.target.value as typeof role }))}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select><ConfirmButton label={`Remove ${displayName(member)}`} confirmLabel="Remove" disabled={busy} icon={<Trash2 size={14} />} onConfirm={() => void attempt(() => removeMember({ sessionToken, teamId: workspace._id, memberId: member._id }))} /></> : <span className="role-label">{roleLabel(member.role)}</span>}
      </div>)}</div>
    </section>
    {!!workspaceInvites?.length && <section className="settings-group">
      <h4>Pending invites<span className="settings-count">{workspaceInvites.length}</span></h4>
      <div className="settings-list">{workspaceInvites.map(invite => <div className="settings-list-row pending-invitation" key={invite._id}>
        <span className="settings-row-icon"><UserPlus size={15} /></span>
        <div><strong>{invite.email || `${roleLabel(invite.role)} link`}</strong><small>{invite.email ? `${roleLabel(invite.role)} · ` : ""}Created {formatDateTime(invite.createdAt)} by {creator(invite.createdBy)} · Expires {formatDate(invite.expiresAt)}</small></div>
        <button type="button" className="icon-button" title="Copy invite link" aria-label={`Copy ${invite.email || `${invite.role} invite`} link`} onClick={() => copy(`${localAppOrigin()}/join/${invite.token}`, invite._id)}>{copied === invite._id ? <Check size={14} /> : <Copy size={14} />}</button>
        <ConfirmButton label={`Revoke ${invite.email || `${invite.role} invite`}`} confirmLabel="Revoke" disabled={busy} icon={<Trash2 size={14} />} onConfirm={() => void attempt(() => revokeInvite({ sessionToken, inviteId: invite._id }))} />
      </div>)}</div>
    </section>}
  </>;
}
