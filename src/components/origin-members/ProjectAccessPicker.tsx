import { useId, useState, type ReactNode } from "react";
import { Check, Lock, Search, ShieldCheck, UserCheck, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import type { WorkspaceMember } from "@/lib/origin-members";
import { grantable, seesEveryProject, type AccessMode, type ProjectAccess } from "@/lib/origin-project-access";
import { MemberAvatar } from "./MemberAvatar";

const MODES: { id: AccessMode; title: string; body: string; icon: ReactNode }[] = [
  { id: "private", title: "Only me", body: "Plus workspace admins", icon: <Lock size={15} /> },
  { id: "everyone", title: "Everyone", body: "All current members", icon: <Users size={15} /> },
  { id: "people", title: "Select members", body: "Choose who sees it", icon: <UserCheck size={15} /> },
];

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };

function adminNames(admins: readonly WorkspaceMember[]): string {
  const named = admins.slice(0, 3).map((member) => `${member.name || member.email} (${ROLE_LABEL[member.role]?.toLowerCase() ?? member.role})`);
  return admins.length > 3 ? `${named.join(", ")} and ${admins.length - 3} more` : named.join(", ");
}

export function ProjectAccessPicker({ members, myEmail, value, onChange, disabled = false }: {
  members: readonly WorkspaceMember[] | undefined;
  myEmail: string;
  value: ProjectAccess;
  onChange(next: ProjectAccess): void;
  disabled?: boolean;
}) {
  const name = useId();
  const [query, setQuery] = useState("");
  const candidates = members ? grantable(members, myEmail) : [];
  const admins = (members ?? []).filter((member) => seesEveryProject(member.role) && member.email !== myEmail);
  const chosen = new Set(value.emails.map((email) => email.toLowerCase()));
  const needle = query.trim().toLowerCase();
  const shown = needle ? candidates.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(needle)) : candidates;
  const toggle = (email: string) => {
    const next = chosen.has(email.toLowerCase()) ? value.emails.filter((item) => item.toLowerCase() !== email.toLowerCase()) : [...value.emails, email];
    onChange({ mode: "people", emails: next });
  };
  const allChosen = candidates.length > 0 && candidates.every((member) => chosen.has(member.email.toLowerCase()));

  return (
    <div className="@container min-w-0"><fieldset disabled={disabled} className="min-w-0" data-project-access>
      <legend className="mb-2 text-[13px] text-ink-secondary">Who has access</legend>
      <div role="radiogroup" aria-label="Who has access" className="grid grid-cols-1 gap-2 @[26rem]:grid-cols-3">
        {MODES.map((mode) => {
          const selected = value.mode === mode.id;
          return (
            <label key={mode.id}
              className={cn("group relative flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-[border-color,background-color,box-shadow] duration-(--motion-slow)",
                selected ? "border-accent/70 bg-accent/[0.07]" : "border-hairline/60 hover:border-hairline hover:bg-raised/40",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60")}>
              <input type="radio" name={name} value={mode.id} aria-label={mode.title} checked={selected} className="sr-only"
                onChange={() => onChange({ mode: mode.id, emails: mode.id === "people" ? value.emails : [] })} />
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors", selected ? "bg-accent text-accent-ink" : "bg-raised text-ink-secondary group-hover:text-ink")} aria-hidden="true">{mode.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{mode.title}</span>
                <span className="block text-[12px] leading-snug text-ink-tertiary">{mode.body}</span>
              </span>
            </label>
          );
        })}
      </div>

      {value.mode === "people" && (
        <div className="mt-2.5 origin-top overflow-hidden rounded-xl border border-hairline/50 bg-inset/40 motion-safe:animate-pop-in">
          <div className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2">
            <Search size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" aria-label="Search members"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
            {candidates.length > 1 && (
              <button type="button" className="shrink-0 rounded-md px-2 py-0.5 text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
                onClick={() => onChange({ mode: "people", emails: allChosen ? [] : candidates.map((member) => member.email) })}>
                {allChosen ? "Clear" : "Select all"}
              </button>
            )}
          </div>
          {members === undefined ? <p className="px-3 py-3 text-[12.5px] text-ink-tertiary">Loading members…</p>
            : candidates.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-ink-tertiary">No one else to choose yet. Invite people from the workspace menu.</p>
              : (
                <ul className="max-h-56 overflow-y-auto py-1" aria-label="Members">
                  {shown.map((member) => {
                    const on = chosen.has(member.email.toLowerCase());
                    return (
                      <li key={member._id}>
                        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-raised/50">
                          <input type="checkbox" className="sr-only peer" checked={on} onChange={() => toggle(member.email)} />
                          <MemberAvatar person={member} className="size-7 text-[11px]" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-ink">{member.name || member.email}</span>
                            <span className="block truncate text-[11.5px] text-ink-tertiary">{member.email}{member.role === "viewer" ? " · read only" : ""}</span>
                          </span>
                          <span aria-hidden="true" className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,transform] duration-(--motion-fast) peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60",
                            on ? "scale-100 border-accent bg-accent text-accent-ink" : "border-hairline bg-transparent text-transparent")}>
                            <Check size={12} strokeWidth={3} />
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {shown.length === 0 && <li className="px-3 py-2 text-[12.5px] text-ink-tertiary">No one matches “{query.trim()}”.</li>}
                </ul>
              )}
        </div>
      )}

      {admins.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-ink-tertiary">
          <ShieldCheck size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span>{adminNames(admins)} always {admins.length === 1 ? "has" : "have"} access.</span>
        </p>
      )}
    </fieldset></div>
  );
}
