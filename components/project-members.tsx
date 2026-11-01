"use client";
import { errorText } from "@/lib/error-text";
import { localAppOrigin } from "@/lib/client-api";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Link, Trash2, UserPlus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { UserAvatar } from "./user-avatar";
import { useWorkspace } from "./workspace-context";
import { ContentSkeleton } from "./content-skeleton";

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
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const attempt = async (fn: () => Promise<unknown>) => { setBusy(true); setNotice(""); try { await fn(); } catch (error) { setNotice(errorText(error, "Could not update members")); } finally { setBusy(false); } };
  const available = workspacePeople?.filter(person => !people?.some(member => member.email === person.email)) || [];
  return <section className="project-members"><h3>Members</h3>{admin && <>
    <form className="project-members-form" onSubmit={event => { event.preventDefault(); void attempt(async () => { await add({ sessionToken, projectId, email, role }); setEmail(""); }); }}><label>Workspace member<select value={email} required onChange={event => setEmail(event.target.value)}><option value="">Select member</option>{available.map(person => <option key={person.email} value={person.email}>{person.username || person.name}</option>)}</select></label><label>Access<select value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="member">Can edit</option><option value="viewer">Can view</option></select></label><button className="primary-button compact" disabled={busy || !email}><UserPlus size={15} />Add member</button></form>
    <button type="button" className="ghost-button compact" disabled={busy} onClick={() => attempt(async () => { const result = await createInvite({ sessionToken, teamId: workspace._id, projectId, role }); setLink(`${localAppOrigin()}/join/${result.token}`); })}><Link size={14} />Create project invite link</button>
    {link && <div className="invite-link"><input aria-label="Project invitation link" readOnly value={link} /><button type="button" className="icon-button" title="Copy invitation" aria-label="Copy invitation" onClick={() => attempt(async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); })}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>}
  </>}{notice && <p className="notice danger" role="alert">{notice}</p>}
    {!people ? <ContentSkeleton rows={3} /> : <div className="workspace-member-list">{people.map(person => {
      const explicit = memberships?.find(member => member.email === person.email && member.status === "active");
      const inherited = workspacePeople?.some(member => member.email === person.email && ["owner", "admin"].includes(member.role));
      return <div className="workspace-member" key={person.email}><UserAvatar user={person} /><span className="project-member-name">{person.username || person.name}</span><small>{inherited ? "Workspace admin" : person.role === "viewer" ? "Can view" : "Can edit"}</small>{admin && explicit && !inherited && explicit.role !== "owner" && <button type="button" className="icon-button" disabled={busy} title="Remove from project" aria-label={`Remove ${person.name} from project`} onClick={() => { if (confirm(`Remove ${person.name} from this project?`)) void attempt(() => remove({ sessionToken, projectId, memberId: explicit._id })); }}><Trash2 size={14} /></button>}</div>;
    })}</div>}
    {invites?.filter(invite => invite.projectId === projectId).map(invite => <div className="pending-invitation" key={invite._id}><Link size={14} /><span>Invite link · {invite.role}</span><button type="button" className="icon-button" title="Copy invitation" aria-label="Copy project invitation" onClick={() => attempt(() => navigator.clipboard.writeText(`${localAppOrigin()}/join/${invite.token}`))}><Copy size={14} /></button><button type="button" className="icon-button" title="Revoke invitation" aria-label="Revoke project invitation" disabled={busy} onClick={() => attempt(() => revoke({ sessionToken, inviteId: invite._id }))}><Trash2 size={14} /></button></div>)}
  </section>;
}
