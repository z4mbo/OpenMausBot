import { useState, type FormEvent } from "react";
import { copyText } from "@/lib/copy-text";
import { Select } from "../Select";
import { Check, Cloud, Copy, Link, Loader2, LogIn, LogOut, Mail, Trash2, UserPlus, Users } from "lucide-react";
import { useCloudSession, useCloudUrl } from "@/lib/origin-cloud";
import {
  INVITE_ROLES, joinLink, originMembers, originWebUrl, rememberWebUrlFrom, setOriginWebUrl,
  useWorkspaceAccess, useWorkspaceInvites, useWorkspaceMembers,
  type InviteRole, type WorkspaceInvite, type WorkspaceMember,
} from "@/lib/origin-members";
import { cn } from "@/lib/cn";
import { OriginConnectDialog } from "../OriginConnect";
import { EmptyState, Field, Loading, Notice, cardClass, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };

export function WorkspaceMembersPanel({ cloudTeamId }: { cloudTeamId: string | null }) {
  const url = useCloudUrl();
  const session = useCloudSession();
  const [connecting, setConnecting] = useState(false);
  const signedIn = Boolean(session.user && session.token);
  const dialog = connecting && <OriginConnectDialog onClose={() => setConnecting(false)} />;
  const connectButton = (
    <button type="button" className={primaryButton} onClick={() => setConnecting(true)}><LogIn size={14} />Sign in to Origin</button>
  );

  if (!url || (session.ready && !signedIn)) {
    return <>
      <EmptyState icon={<LogIn size={28} />} title="Sign in to Origin"
        body="Workspace members and invitations live in your Origin workspace. Sign in to see who is in it and invite people."
        action={connectButton} />
      {dialog}
    </>;
  }
  if (!session.ready) return <Loading label="Connecting to Origin" />;
  if (!cloudTeamId) {
    return <EmptyState icon={<Cloud size={28} />} title="No Origin workspace selected"
      body="Pick or connect an Origin workspace to manage its members." />;
  }
  return <Members teamId={cloudTeamId} myEmail={session.user?.email ?? ""} />;
}

function Members({ teamId, myEmail }: { teamId: string; myEmail: string }) {
  const access = useWorkspaceAccess(teamId);
  const isAdmin = access?.role === "owner" || access?.role === "admin";
  const members = useWorkspaceMembers(teamId);
  const invites = useWorkspaceInvites(teamId, isAdmin);
  const action = useAction();
  const [left, setLeft] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [webBase, setWebBase] = useState(originWebUrl);

  if (left) return <EmptyState icon={<LogOut size={28} />} title="You left this workspace" body="You need a new invitation to come back." />;
  if (!access || !members) return <Loading label="Loading members" />;

  const workspaceInvites = (invites ?? []).filter((invite) => !invite.projectId);
  const leave = async () => {
    if (await action.run(() => originMembers.leave(teamId), "Could not leave the workspace")) setLeft(true);
  };

  return (
    <section className="flex-1 overflow-y-auto p-6" aria-label="Workspace members">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-[17px] font-semibold text-ink">Members</h2>
        <span className="text-[13px] text-ink-tertiary">{members.length}</span>
        <span className="ml-auto text-[12.5px] text-ink-tertiary">You are {ROLE_LABEL[access.role]?.toLowerCase() ?? access.role}</span>
      </div>
      {action.error && <div className="mb-3"><Notice tone="danger">{action.error}</Notice></div>}

      {isAdmin && <InviteForm teamId={teamId} webBase={webBase} onWebBase={setWebBase} />}

      <ul className={cn(cardClass, "mb-5 divide-y divide-hairline/30")} aria-label="Members">
        {members.map((member) => (
          <MemberRow key={member._id} member={member} isMe={member.email === myEmail} canManage={isAdmin}
            busy={action.busy}
            onRole={(role) => void action.run(() => originMembers.updateRole({ teamId, memberId: member._id, role }), "Could not change the role")}
            onRemove={() => {
              if (window.confirm(`Remove ${member.name || member.email} from this workspace?`)) {
                void action.run(() => originMembers.removeMember({ teamId, memberId: member._id }), "Could not remove the member");
              }
            }} />
        ))}
      </ul>

      {isAdmin && (
        <div className="mb-5">
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Pending invitations</h3>
          {invites === undefined ? <Loading label="Loading invitations" />
            : workspaceInvites.length === 0
              ? <p className="rounded-xl bg-inset px-3 py-2.5 text-[13px] text-ink-secondary">No open invitations.</p>
              : <ul className={cn(cardClass, "divide-y divide-hairline/30")} aria-label="Pending invitations">
                {workspaceInvites.map((invite) => (
                  <InviteRow key={invite._id} invite={invite} webBase={webBase} busy={action.busy}
                    onRevoke={() => void action.run(() => originMembers.revokeInvite(invite._id), "Could not revoke the invitation")} />
                ))}
              </ul>}
        </div>
      )}

      {access.role !== "owner" && (
        <div className={cn(cardClass, "flex flex-wrap items-center gap-3 p-4")}>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-ink">Leave workspace</h3>
            <p className="text-[12.5px] text-ink-secondary">You lose access to its projects and connectors. Coming back needs a new invitation.</p>
          </div>
          {confirmLeave
            ? <div className="flex gap-2">
              <button type="button" className={ghostButton} disabled={action.busy} onClick={() => setConfirmLeave(false)}>Cancel</button>
              <button type="button" className={cn(ghostButton, "text-danger hover:text-danger")} disabled={action.busy} onClick={() => void leave()}>
                {action.busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}Leave
              </button>
            </div>
            : <button type="button" className={cn(ghostButton, "text-danger hover:text-danger")} onClick={() => setConfirmLeave(true)}><LogOut size={14} />Leave workspace</button>}
        </div>
      )}
    </section>
  );
}

function initials(name: string, email: string): string {
  const words = (name || email).trim().split(/[\s@._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  if (member.avatarUrl) return <img src={member.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />;
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold text-ink-secondary">
      {initials(member.name, member.email)}
    </span>
  );
}

function MemberRow({ member, isMe, canManage, busy, onRole, onRemove }: {
  member: WorkspaceMember; isMe: boolean; canManage: boolean; busy: boolean; onRole(role: InviteRole): void; onRemove(): void;
}) {
  const editable = canManage && member.role !== "owner" && !isMe;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <MemberAvatar member={member} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{member.name || member.email}{isMe && <span className="ml-1.5 text-ink-tertiary">(you)</span>}</p>
        <p className="truncate text-[12px] text-ink-secondary">{member.email}</p>
      </div>
      {editable ? <>
        <Select className={cn(inputClass, "w-auto")} aria-label={`Role for ${member.name || member.email}`} value={member.role} disabled={busy}
          onChange={(event) => onRole(event.target.value as InviteRole)}>
          {INVITE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
        </Select>
        <button type="button" className={iconButton} disabled={busy} title="Remove member" aria-label={`Remove ${member.name || member.email}`} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </> : <span className="rounded-md bg-inset px-2 py-0.5 text-[12px] text-ink-secondary">{ROLE_LABEL[member.role] ?? member.role}</span>}
    </li>
  );
}

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    void copyText(text).then((result) => {
      if (result !== "copied") return;
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    });
  };
  return [copied, copy];
}

function InviteRow({ invite, webBase, busy, onRevoke }: { invite: WorkspaceInvite; webBase: string | null; busy: boolean; onRevoke(): void }) {
  const [copied, copy] = useCopy();
  const link = joinLink(invite.token, webBase);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-inset text-ink-secondary" aria-hidden="true">
        {invite.email ? <Mail size={14} /> : <Link size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{invite.email ?? "Shareable link"}</p>
        <p className="text-[12px] text-ink-secondary">{ROLE_LABEL[invite.role] ?? invite.role} · Expires {new Date(invite.expiresAt).toLocaleDateString()}</p>
      </div>
      <button type="button" className={iconButton} disabled={!link} title={link ? "Copy invite link" : "Set the Origin web address first"}
        aria-label="Copy invite link" onClick={() => link && copy(invite._id, link)}>
        {copied === invite._id ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button type="button" className={iconButton} disabled={busy} title="Revoke invitation" aria-label="Revoke invitation" onClick={onRevoke}>
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function InviteForm({ teamId, webBase, onWebBase }: { teamId: string; webBase: string | null; onWebBase(base: string | null): void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [result, setResult] = useState<{ link: string | null; token: string; note?: string } | null>(null);
  const [webUrl, setWebUrl] = useState("");
  const [copied, copy] = useCopy();
  const action = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    await action.run(async () => {
      if (address) {
        const sent = await originMembers.sendEmailInvite({ teamId, email: address, role });
        rememberWebUrlFrom(sent.inviteLink);
        onWebBase(originWebUrl());
        const token = sent.inviteLink.split("/join/").pop() ?? "";
        setResult({ link: sent.inviteLink, token, note: sent.sent ? `Invitation emailed to ${address}.` : "Origin could not send email from this backend, so share the link yourself." });
      } else {
        const created = await originMembers.createInvite({ teamId, role });
        setResult({ link: joinLink(created.token, webBase), token: created.token });
      }
      setEmail("");
    }, "Could not create the invitation");
  };

  const saveWebUrl = () => {
    setOriginWebUrl(webUrl);
    const base = originWebUrl();
    onWebBase(base);
    if (result) setResult({ ...result, link: joinLink(result.token, base) });
  };

  return (
    <div className={cn(cardClass, "mb-5 p-4")}>
      <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink"><UserPlus size={14} aria-hidden="true" />Invite people</h3>
      <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-2">
        <Field label="Email (optional)" className="min-w-[200px] flex-1">
          <input className={inputClass} type="email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Role">
          <Select className={cn(inputClass, "w-auto")} value={role} onChange={(event) => setRole(event.target.value as InviteRole)}>
            {INVITE_ROLES.map((option) => <option key={option} value={option}>{ROLE_LABEL[option]}</option>)}
          </Select>
        </Field>
        <button className={primaryButton} disabled={action.busy}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : email.trim() ? <Mail size={14} /> : <Link size={14} />}
          {email.trim() ? "Send invite" : "Create link"}
        </button>
      </form>
      <p className="mt-2 text-[12px] text-ink-tertiary">Links work for 7 days. An invite with an email only works for that address.</p>
      {action.error && <div className="mt-3"><Notice tone="danger">{action.error}</Notice></div>}
      {result && (
        <div className="mt-3 space-y-2">
          {result.note && <Notice>{result.note}</Notice>}
          {result.link
            ? <div className="flex items-center gap-2">
              <input className={inputClass} aria-label="Invitation link" value={result.link} readOnly onFocus={(event) => event.currentTarget.select()} />
              <button type="button" className={iconButton} title="Copy invite link" aria-label="Copy invite link" onClick={() => copy("new", result.link!)}>
                {copied === "new" ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            : <Notice>Invitation created. Add your Origin web address below to get a link you can share.</Notice>}
        </div>
      )}
      {!webBase && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Origin web address" className="min-w-[200px] flex-1">
            <input className={inputClass} placeholder="https://origin.example.com" value={webUrl} onChange={(event) => setWebUrl(event.target.value)} />
          </Field>
          <button type="button" className={ghostButton} disabled={!webUrl.trim()} onClick={saveWebUrl}><Users size={14} />Use for links</button>
        </div>
      )}
    </div>
  );
}
