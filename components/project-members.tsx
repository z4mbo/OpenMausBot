"use client";
import { errorText } from "@/lib/error-text";
import { localAppOrigin } from "@/lib/client-api";
import { displayName } from "@/lib/format";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Link, Loader2, UserPlus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { UserAvatar } from "./user-avatar";
import { useWorkspace } from "./workspace-context";
import { DelayedSkeleton } from "./delayed-skeleton";
import { ConfirmButton } from "./confirm-button";

const accessLabel = (role: string) => role === "viewer" ? "Can view" : "Can edit";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="icon-button" aria-label={copied ? "Copied" : label} title={label} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* Clipboard blocked: the link stays selectable in the field. */ } }}>{copied ? <Check size={15} className="copied-icon" /> : <Copy size={15} />}</button>;
}

export function ProjectMembers({ projectId, sessionToken }: { projectId: Id<"projects">; sessionToken: string }) {
  const workspace = useWorkspace();
  const admin = ["owner", "admin"].includes(workspace.role);
  const people = useQuery(api.members.people, { projectId, sessionToken });
  const memberships = useQuery(api.members.list, admin ? { projectId, sessionToken } : "skip");
  const workspacePeople = useQuery(api.workspaces.members, admin ? { teamId: workspace._id, sessionToken } : "skip");
  const invites = useQuery(api.workspaces.invitations, admin ? { teamId: workspace._id, sessionToken } : "skip");
  const add = useMutation(api.members.addWorkspaceMember);
  const remove = useMutation(api.members.remove);
  const createInvite = useMutation(api.workspaces.createInvite);
  const revoke = useMutation(api.workspaces.revokeInvite);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "add" | "invite" | "other">("");
  const attempt = async (kind: "add" | "invite" | "other", fn: () => Promise<unknown>) => { setBusy(kind); setNotice(""); try { await fn(); } catch (error) { setNotice(errorText(error, "Could not update members")); } finally { setBusy(""); } };
  const available = workspacePeople?.filter(person => !people?.some(member => member.email === person.email)) || [];
  const projectInvites = invites?.filter(invite => invite.projectId === projectId) || [];
  return <div className="project-members-panel">
    {admin && available.length > 0 && <form className="project-member-add" onSubmit={event => { event.preventDefault(); void attempt("add", async () => { await add({ sessionToken, projectId, email, role }); setEmail(""); }); }}>
      <select aria-label="Workspace member" value={email} required onChange={event => setEmail(event.target.value)}><option value="">Add a workspace member</option>{available.map(person => <option key={person.email} value={person.email}>{displayName(person)}</option>)}</select>
      <select aria-label="Access" value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="member">Can edit</option><option value="viewer">Can view</option></select>
      <button className="primary-button compact" disabled={Boolean(busy) || !email}>{busy === "add" ? <Loader2 className="spin" size={14} /> : <UserPlus size={14} />}Add</button>
    </form>}
    {notice && <p className="notice danger" role="alert">{notice}</p>}
    {!people ? <DelayedSkeleton rows={3} label="Loading members" /> : <ul className="project-member-list">{people.map(person => {
      const explicit = memberships?.find(member => member.email === person.email && member.status === "active");
      const inherited = workspacePeople?.some(member => member.email === person.email && ["owner", "admin"].includes(member.role));
      const name = displayName(person);
      return <li className="project-member" key={person.email}>
        <UserAvatar user={person} />
        <span className="project-member-name"><strong>{name}</strong><small>{person.email}</small></span>
        <span className="project-member-role">{inherited ? "Admin" : accessLabel(person.role)}</span>
        {admin && explicit && !inherited && explicit.role !== "owner" ? <ConfirmButton className="icon-button" label={`Remove ${name}`} confirmLabel="Remove" icon={<X size={14} />} disabled={Boolean(busy)} onConfirm={() => attempt("other", () => remove({ sessionToken, projectId, memberId: explicit._id }))} /> : admin ? <span className="project-member-spacer" aria-hidden="true" /> : null}
      </li>;
    })}</ul>}
    {admin && <div className="project-invites">
      {projectInvites.map(invite => {
        const link = `${localAppOrigin()}/join/${invite.token}`;
        return <div className="project-invite" key={invite._id}>
          <Link size={14} />
          <input aria-label="Invite link" readOnly value={link} onFocus={event => event.currentTarget.select()} />
          <span className="project-member-role">{accessLabel(invite.role)}</span>
          <CopyButton value={link} label="Copy invite link" />
          <ConfirmButton className="icon-button" label="Revoke invite link" confirmLabel="Revoke" icon={<X size={14} />} disabled={Boolean(busy)} onConfirm={() => attempt("other", () => revoke({ sessionToken, inviteId: invite._id }))} />
        </div>;
      })}
      <button type="button" className="ghost-button compact" disabled={Boolean(busy)} onClick={() => attempt("invite", () => createInvite({ sessionToken, teamId: workspace._id, projectId, role }))}>{busy === "invite" ? <Loader2 className="spin" size={14} /> : <Link size={14} />}Create invite link</button>
    </div>}
  </div>;
}
