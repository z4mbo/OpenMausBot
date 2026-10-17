import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Cloud, Loader2, LogIn, X } from "lucide-react";
import { useCloudQuery, useCloudSession, useCloudUrl, type CloudUser } from "@/lib/origin-cloud";
import { useWorkspaceAccess, type WorkspaceRole } from "@/lib/origin-members";
import { cn } from "@/lib/cn";
import type { CloudProject } from "./cloud-types";
import { errorText } from "./repo-url";

export type OriginPageProps = { cloudProjectId: string | null; projectName: string };

export const inputClass =
  "w-full rounded-lg border border-hairline/60 bg-inset px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-tertiary outline-none focus:border-accent/70 disabled:opacity-60";
export const primaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline/60 px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";
export const iconButton =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
export const cardClass = "rounded-xl border border-hairline/40 bg-panel";

export type ProjectContext = { project: CloudProject; projectId: string; canEdit: boolean; isAdmin: boolean };

export function CloudGate({ cloudProjectId, projectName, label, children }: OriginPageProps & { label: string; children: (ctx: ProjectContext) => ReactNode }) {
  const url = useCloudUrl();
  const session = useCloudSession();
  const signedIn = Boolean(session.user && session.token);
  const project = useCloudQuery<CloudProject>("projects:get", cloudProjectId && signedIn ? { projectId: cloudProjectId } : "skip");
  if (!cloudProjectId) {
    return <EmptyState icon={<Cloud size={28} />} title="Connect this project to Origin" body={`${projectName} is not linked to an Origin cloud project yet, so its ${label.toLowerCase()} live only on Origin once you connect it.`} />;
  }
  if (!url) return <EmptyState icon={<Cloud size={28} />} title="Origin is not set up" body="Add your Origin cloud address in settings to see this project's data." />;
  if (!session.ready) return <Loading label="Connecting to Origin" />;
  if (!signedIn) return <SignIn onLogin={session.login} label={label} />;
  if (project === undefined) return <Loading label={`Loading ${label.toLowerCase()}`} />;
  return <>{children({ project, projectId: cloudProjectId, canEdit: project.memberRole !== "viewer", isAdmin: project.memberRole === "owner" || project.memberRole === "admin" })}</>;
}

export type WorkspaceContext = { teamId: string; me: CloudUser; role: WorkspaceRole; canEdit: boolean };

export function WorkspaceGate({ teamId, label, children }: { teamId: string | null; label: string; children: (ctx: WorkspaceContext) => ReactNode }) {
  const url = useCloudUrl();
  const session = useCloudSession();
  const signedIn = Boolean(session.user && session.token);
  const access = useWorkspaceAccess(teamId && signedIn ? teamId : null);
  if (!url) return <EmptyState icon={<Cloud size={28} />} title="Origin is not set up" body="Add your Origin cloud address in settings to use the workspace pages." />;
  if (!session.ready) return <Loading label="Connecting to Origin" />;
  if (!signedIn || !session.user) return <SignIn onLogin={session.login} label={label} />;
  if (!teamId) {
    return <EmptyState icon={<Cloud size={28} />} title="Connect this workspace to Origin" body={`This workspace is not linked to an Origin workspace yet. Use Import from Origin in the workspace menu, and its ${label.toLowerCase()} appear here.`} />;
  }
  if (access === undefined) return <Loading label={`Loading ${label.toLowerCase()}`} />;
  return <>{children({ teamId, me: session.user, role: access.role, canEdit: access.role !== "viewer" })}</>;
}

function SignIn({ onLogin, label }: { onLogin(email: string, password: string): Promise<void>; label: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(errorText(err, "Could not sign in"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" aria-label="Sign in to Origin">
      <LogIn size={28} className="text-ink-secondary" aria-hidden="true" />
      <h2 className="text-[17px] font-semibold text-ink">Sign in to Origin</h2>
      <p className="max-w-sm text-[13px] text-ink-secondary">{label} come from your Origin workspace. Sign in to see them.</p>
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-2 text-left">
        <input className={inputClass} type="email" autoComplete="username" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={inputClass} type="password" autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <Notice tone="danger">{error}</Notice>}
        <button className={primaryButton} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}Sign in</button>
      </form>
    </section>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="text-ink-secondary" aria-hidden="true">{icon}</span>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {body && <p className="max-w-sm text-[13px] text-ink-secondary">{body}</p>}
      {action}
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-1 items-center justify-center gap-2 p-6 text-[13px] text-ink-secondary">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />{label}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "danger"; children: ReactNode }) {
  return (
    <p role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-lg px-3 py-2 text-[12.5px]", tone === "danger" ? "bg-danger/10 text-danger" : "bg-raised/60 text-ink-secondary")}>
      {children}
    </p>
  );
}

export function PageHeader({ title, count, children }: { title: string; count?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      {count !== undefined && <span className="text-[13px] text-ink-tertiary">{count}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-[12px] font-medium text-ink-secondary", className)}>
      {label}
      {children}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 md:p-10" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cn("w-full rounded-xl border border-hairline/60 bg-menu shadow-2xl", wide ? "max-w-4xl" : "max-w-md")}>
        <div className="flex items-center gap-2 border-b border-hairline/40 px-4 py-3">
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{title}</h3>
          <button type="button" className={iconButton} aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: NoInfer<T>; label: ReactNode }[]; onChange(value: NoInfer<T>): void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg bg-inset p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}
          className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] text-ink-secondary hover:text-ink", option.value === value && "bg-raised text-ink")}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function useAction(): { busy: boolean; error: string; setError(value: string): void; run(fn: () => Promise<unknown>, fallback: string): Promise<boolean> } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
