import { useState, type FormEvent } from "react";
import { copyText } from "@/lib/copy-text";
import { Select } from "../Select";
import { Check, Cloud, Copy, Crown, Link, Loader2, LogIn, LogOut, Mail, Search, ShieldCheck, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useCloudSession, useCloudUrl } from "@/lib/origin-cloud";
import {
  INVITE_ROLES, joinLink, originMembers, useAppAddress,
  useWorkspaceAccess, useWorkspaceInvites, useWorkspaceMembers,
  type InviteRole, type WorkspaceInvite, type WorkspaceMember, type WorkspaceRole,
} from "@/lib/origin-members";
import { requestOriginSync } from "@/lib/origin-sync";
import { cn } from "@/lib/cn";
import { OriginConnectDialog } from "../OriginConnect";
import { EmptyState, Field, Loading, Notice, cardClass, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { MemberAvatar } from "./MemberAvatar";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
const ROLE_HINT: Record<InviteRole, string> = {
  admin: "Manages people and sees every project",
  member: "Works in the projects they can access",
  viewer: "Reads the projects they can access",
};
const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
const dangerGhost = cn(ghostButton, "text-danger hover:bg-danger/10 hover:text-danger");

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
  return <Members key={JSON.stringify([url, session.user?._id, cloudTeamId])} teamId={cloudTeamId} myEmail={session.user?.email ?? ""} />;
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function Members({ teamId, myEmail }: { teamId: string; myEmail: string }) {
  const access = useWorkspaceAccess(teamId);
  const isAdmin = access?.role === "owner" || access?.role === "admin";
  const members = useWorkspaceMembers(teamId);
  const invites = useWorkspaceInvites(teamId, isAdmin);
  const action = useAction();
  const [left, setLeft] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [query, setQuery] = useState("");
  const appAddress = useAppAddress();

  if (left) return <EmptyState icon={<LogOut size={28} />} title="You left this workspace" body="It disappears from your sidebar in a moment. You need a new invitation to come back." />;
  if (!access || !members) return <Loading label="Loading members" />;

  const workspaceInvites = (invites ?? []).filter((invite) => !invite.projectId);
  const sorted = [...members].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || (a.name || a.email).localeCompare(b.name || b.email));
  const needle = query.trim().toLowerCase();
  const shown = needle ? sorted.filter((member) => `${member.name} ${member.email} ${member.role}`.toLowerCase().includes(needle)) : sorted;
  const admins = members.filter((member) => member.role === "owner" || member.role === "admin").length;
  const leave = async () => {
    if (await action.run(() => originMembers.leave(teamId), "Could not leave the workspace")) {
      setLeft(true);
      requestOriginSync();
    }
  };

  return (
    <section className="shrink-0 p-4 pb-0 sm:p-6 sm:pb-0" aria-label="Workspace members">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[17px] font-semibold text-ink">Members</h2>
          <span className="rounded-full bg-raised/70 px-2 text-[12px] tabular-nums text-ink-secondary">{members.length}</span>
        </div>
        <span className="text-[12.5px] text-ink-tertiary">{admins} {admins === 1 ? "admin" : "admins"} · {members.length - admins} {members.length - admins === 1 ? "member" : "members"}</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-hairline/50 px-2 py-0.5 text-[12px] text-ink-secondary">
          {access.role === "owner" ? <Crown size={12} aria-hidden="true" /> : access.role === "admin" ? <ShieldCheck size={12} aria-hidden="true" /> : null}
          You are {ROLE_LABEL[access.role]?.toLowerCase() ?? access.role}
        </span>
      </div>
      {action.error && <div className="mb-3"><Notice tone="danger">{action.error}</Notice></div>}

      {isAdmin && <InviteForm teamId={teamId} />}

      {members.length > 6 && (
        <label className="mb-2 flex items-center gap-2 rounded-lg border border-hairline/50 bg-inset/60 px-2.5 py-1.5 transition-colors focus-within:border-accent/70">
          <Search size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" aria-label="Search members"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
        </label>
      )}

      <ul className={cn(cardClass, "mb-5 divide-y divide-hairline/30 overflow-hidden")} aria-label="Members">
        {shown.map((member) => (
          <MemberRow key={member._id} member={member} isMe={sameEmail(member.email, myEmail)} canManage={isAdmin} busy={action.busy}
            onRole={(role) => void action.run(() => originMembers.updateRole({ teamId, memberId: member._id, role }), "Could not change the role")}
            onRemove={() => action.run(() => originMembers.removeMember({ teamId, memberId: member._id }), "Could not remove the member")} />
        ))}
        {shown.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-tertiary">No one matches “{query.trim()}”.</li>}
      </ul>

      {isAdmin && (
        <div className="mb-5">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
            Pending invitations{workspaceInvites.length > 0 && <span className="rounded-full bg-raised/70 px-1.5 text-[11px] tabular-nums text-ink-secondary">{workspaceInvites.length}</span>}
          </h3>
          {invites === undefined ? <Loading label="Loading invitations" />
            : workspaceInvites.length === 0
              ? <p className="rounded-xl bg-inset px-3 py-2.5 text-[13px] text-ink-secondary">No open invitations.</p>
              : <ul className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")} aria-label="Pending invitations">
                {workspaceInvites.map((invite) => (
                  <InviteRow key={invite._id} invite={invite} appAddress={appAddress} busy={action.busy}
                    onRevoke={() => void action.run(() => originMembers.revokeInvite(invite._id), "Could not revoke the invitation")} />
                ))}
              </ul>}
        </div>
      )}

      {access.role === "owner" ? (
        <p className="flex items-center gap-2 px-1 text-[12.5px] text-ink-tertiary"><Crown size={13} aria-hidden="true" />As the owner you stay in this workspace; it cannot be left without an owner.</p>
      ) : (
        <div className={cn(cardClass, "flex flex-wrap items-center gap-3 p-4 transition-colors", confirmLeave && "border-danger/40 bg-danger/[0.04]")}>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-ink">{confirmLeave ? "Leave this workspace?" : "Leave workspace"}</h3>
            <p className="text-[12.5px] text-ink-secondary">You lose access to its projects and connectors. Coming back needs a new invitation.</p>
          </div>
          {confirmLeave
            ? <div className="flex gap-2 motion-safe:animate-pop-in">
              <button type="button" className={ghostButton} disabled={action.busy} onClick={() => setConfirmLeave(false)}>Stay</button>
              <button type="button" autoFocus className={cn(primaryButton, "bg-danger text-white")} disabled={action.busy} onClick={() => void leave()}>
                {action.busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}Leave workspace
              </button>
            </div>
            : <button type="button" className={dangerGhost} onClick={() => setConfirmLeave(true)}><LogOut size={14} />Leave…</button>}
        </div>
      )}
    </section>
  );
}

function MemberRow({ member, isMe, canManage, busy, onRole, onRemove }: {
  member: WorkspaceMember; isMe: boolean; canManage: boolean; busy: boolean; onRole(role: InviteRole): void; onRemove(): Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const editable = canManage && member.role !== "owner" && !isMe;
  const label = member.name || member.email;
  const remove = async () => {
    setRemoving(true);
    if (!await onRemove()) { setRemoving(false); setConfirming(false); }
  };
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-[background-color,opacity] duration-200 motion-safe:animate-pop-in",
      confirming ? "bg-danger/[0.05]" : "hover:bg-raised/30", removing && "opacity-50")}>
      <MemberAvatar person={member} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{label}{isMe && <span className="ml-1.5 font-normal text-ink-tertiary">(you)</span>}</p>
        <p className="truncate text-[12px] text-ink-secondary">{member.username ? `@${member.username} · ` : ""}{member.email}</p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2 motion-safe:animate-pop-in">
          <span className="text-[12.5px] text-ink-secondary">Remove {label.split(/\s+/)[0]}?</span>
          <button type="button" className={ghostButton} disabled={removing} onClick={() => setConfirming(false)}>Cancel</button>
          <button type="button" autoFocus className={cn(primaryButton, "bg-danger text-white")} disabled={removing} onClick={() => void remove()}>
            {removing ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}Remove
          </button>
        </div>
      ) : editable ? (
        <div className="flex items-center gap-1.5">
          <Select size="sm" aria-label={`Role for ${label}`} title={ROLE_HINT[member.role as InviteRole]} value={member.role} disabled={busy}
            onChange={(event) => onRole(event.target.value as InviteRole)}>
            {INVITE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
          </Select>
          <button type="button" className={cn(iconButton, "hover:bg-danger/10 hover:text-danger")} disabled={busy} title="Remove from workspace" aria-label={`Remove ${label}`} onClick={() => setConfirming(true)}>
            <Trash2 size={14} />
          </button>
        </div>
      ) : <RoleBadge role={member.role} />}
    </li>
  );
}

function RoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px]",
      role === "owner" ? "bg-accent/10 text-accent" : role === "admin" ? "bg-raised text-ink" : "bg-inset text-ink-secondary")}>
      {role === "owner" ? <Crown size={11} aria-hidden="true" /> : role === "admin" ? <ShieldCheck size={11} aria-hidden="true" /> : null}
      {ROLE_LABEL[role] ?? role}
    </span>
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

function expiresIn(at: number): string {
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  return days <= 1 ? "Expires today" : `Expires in ${days} days`;
}

function InviteRow({ invite, appAddress, busy, onRevoke }: { invite: WorkspaceInvite; appAddress: string; busy: boolean; onRevoke(): void }) {
  const [copied, copy] = useCopy();
  const link = joinLink(invite.token, appAddress);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 motion-safe:animate-pop-in">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-inset text-ink-secondary" aria-hidden="true">
        {invite.email ? <Mail size={14} /> : <Link size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{invite.email ?? "Shareable link"}</p>
        <p className="text-[12px] text-ink-secondary">
          <span className="mr-1.5 rounded bg-warning/10 px-1.5 py-px text-[11px] text-warning">Invited</span>
          {ROLE_LABEL[invite.role] ?? invite.role} · {expiresIn(invite.expiresAt)}
        </p>
      </div>
      <button type="button" className={iconButton} title={copied === invite._id ? "Copied" : "Copy invite link"}
        aria-label="Copy invite link" onClick={() => copy(invite._id, link)}>
        {copied === invite._id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </button>
      <button type="button" className={cn(iconButton, "hover:bg-danger/10 hover:text-danger")} disabled={busy} title="Revoke invitation" aria-label="Revoke invitation" onClick={onRevoke}>
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function InviteForm({ teamId }: { teamId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [result, setResult] = useState<{ link: string; note?: string } | null>(null);
  const [copied, copy] = useCopy();
  const action = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    await action.run(async () => {
      const created = await originMembers.createInvite({ teamId, role, ...(address ? { email: address } : {}) });
      const note = !address ? undefined : created.sent ? `Invitation emailed to ${address}.` : "Email is not set up on this server, so share the link yourself.";
      setResult({ link: created.inviteLink, note });
      setEmail("");
    }, "Could not create the invitation");
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
      <p className="mt-2 text-[12px] text-ink-tertiary">{ROLE_HINT[role]}. Links work for 7 days; an invite with an email only works for that address.</p>
      {action.error && <div className="mt-3"><Notice tone="danger">{action.error}</Notice></div>}
      {result && (
        <div className="mt-3 space-y-2 motion-safe:animate-pop-in">
          {result.note && <Notice>{result.note}</Notice>}
          <div className="flex items-center gap-2">
            <input className={inputClass} aria-label="Invitation link" value={result.link} readOnly onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className={iconButton} title="Copy invite link" aria-label="Copy invite link" onClick={() => copy("new", result.link)}>
              {copied === "new" ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
