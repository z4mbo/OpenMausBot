import { Component, Fragment, useCallback, useContext, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CloudOff, FolderPlus, Link2, Loader2, LogIn, Plus, RotateCw, SearchX, ServerOff, Users, X } from "lucide-react";
import { cloudMutation, createOriginWorkspace, useCloudQuery, useCloudSession, useCloudUrl, type CloudUser } from "@/lib/origin-cloud";
import { linkCloudRecord, useCloudLinks } from "@/lib/origin-cloud-links";
import { useWorkspaceAccess, type WorkspaceRole } from "@/lib/origin-members";
import { cn } from "@/lib/cn";
import { CenteredDialog } from "../CenteredDialog";
import { GlassHeader, useInGlassHeader } from "../GlassScrollFrame";
import { Select } from "../Select";
import type { CloudProject } from "./cloud-types";
import { errorText } from "./repo-url";
import { OriginQueryFailures, OriginQueryRecovery, OriginQueryUnavailable } from "@/lib/origin-cloud/query-failure";
import { useCloudToken } from "@/lib/origin-cloud/hooks";

export { overlayMotion, sheetMotion, useDismiss } from "../CenteredDialog";

/** Where an unlinked project page can create or link its shared project: the local project lead and its workspace's cloud id. */
export type ProjectLink = { botId: string; teamId: string | null };

export type OriginPageProps = { cloudProjectId: string | null; projectName: string; link?: ProjectLink };

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-app";

export const inputClass =
  "w-full rounded-lg border border-hairline/60 bg-inset px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-tertiary outline-none transition-colors hover:border-hairline focus:border-accent/70 disabled:opacity-60 max-md:text-[16px]";
export const primaryButton =
  `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${focusRing}`;
export const ghostButton =
  `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-hairline/60 px-3 py-1.5 text-[13px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const iconButton =
  `inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
export const cardClass = "min-w-0 rounded-xl border border-hairline/40 bg-panel";
export const chipButton =
  `inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border border-hairline/60 bg-raised/60 px-3 text-[12.5px] text-ink-secondary transition-colors hover:border-hairline hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
/** Clears the glass header a page scrolls beneath; `--glass-top` is the header's height, published by its frame. */
export const underGlass = "pt-[calc(var(--glass-top,0px)+1.25rem)] [scroll-padding-top:var(--glass-top,0px)]";
/** A list row that eases in when it is added. */
export const itemIn = "motion-safe:animate-[item-in_var(--motion-base)_var(--ease-out)_backwards]";
/** The scrolling body every project and workspace page shares. */
export const pageClass = `flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-5 md:px-6 ${underGlass} motion-safe:animate-[rise_var(--motion-base)_var(--ease-out)_backwards]`;

function GateShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">{children}</div>;
}

/** How long a gate waits on a query before offering a retry: a failed query reads as still loading. */
const GATE_STALL_MS = 12_000;

function useStalled(waiting: boolean): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!waiting) return;
    const timer = window.setTimeout(() => setStalled(true), GATE_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  return waiting && stalled;
}

function Stalled({ label, onRetry }: { label: string; onRetry(): void }) {
  return (
    <EmptyState icon={<CloudOff size={22} />} title={`Could not load ${label.toLowerCase()}`}
      action={<button type="button" className={ghostButton} onClick={onRetry}><RotateCw size={14} />Try again</button>} />
  );
}

class QueryFailureBoundary extends Component<{ label: string; onRetry(): void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      if (!(this.state.error instanceof OriginQueryUnavailable)) throw this.state.error;
      return <GateShell><Stalled label={this.props.label} onRetry={this.props.onRetry} /></GateShell>;
    }
    return this.props.children;
  }
}

export function CloudQueryBoundary({ label, children }: { label: string; children: ReactNode }) {
  const url = useCloudUrl();
  const token = useCloudToken();
  const [scope, setScope] = useState({ url, token, revision: 0 });
  const [failures, setFailures] = useState<ReadonlySet<string>>(new Set());
  const current = scope.url === url && scope.token === token ? scope : { url, token, revision: scope.revision + 1 };
  if (current !== scope) { setScope(current); setFailures(new Set()); }
  const [attempt, retry] = useRetry();
  const [refresh, refreshQueries] = useRetry();
  const reportFailure = useCallback((key: string, failed: boolean) => setFailures((current) => {
    if (current.has(key) === failed) return current;
    const next = new Set(current);
    if (failed) next.add(key);
    else next.delete(key);
    return next;
  }), []);
  const recovery = useMemo(() => ({ attempt: attempt + refresh, label, failureCount: failures.size, retry: refreshQueries, reportFailure }), [attempt, refresh, label, failures.size, refreshQueries, reportFailure]);
  return <OriginQueryRecovery value={recovery}>
    {failures.size > 0 && <GlassHeader><div className={glassHeaderRow}><CloudQueryRefreshNotice /></div></GlassHeader>}
    <QueryFailureBoundary key={`${current.revision}:${attempt}`} label={label} onRetry={retry}><OriginQueryFailures value={true}>{children}</OriginQueryFailures></QueryFailureBoundary>
  </OriginQueryRecovery>;
}

export function CloudQueryRefreshNotice({ className }: { className?: string }) {
  const recovery = useContext(OriginQueryRecovery);
  if (!recovery?.failureCount) return null;
  return <div className={className}><Notice tone="danger">Could not refresh {recovery.label.toLowerCase()}. Showing the last loaded data.<button type="button" className={cn(ghostButton, "ml-2 min-h-7 px-2 py-1 text-[12px]")} onClick={recovery.retry}>Try again</button></Notice></div>;
}

/** Remounts a gate on retry, so its queries subscribe afresh. */
function useRetry(): [number, () => void] {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [attempt, retry];
}

export type ProjectContext = { project: CloudProject; projectId: string; canEdit: boolean; isAdmin: boolean };

type CloudGateProps = OriginPageProps & { label: string; children: (ctx: ProjectContext) => ReactNode };

export function CloudGate(props: CloudGateProps) {
  const [attempt, retry] = useRetry();
  return <CloudQueryBoundary key={props.cloudProjectId} label={props.label}><ProjectGate key={attempt} {...props} onRetry={retry} /></CloudQueryBoundary>;
}

function ProjectGate({ cloudProjectId, projectName, link, label, children, onRetry }: CloudGateProps & { onRetry(): void }) {
  const url = useCloudUrl();
  const session = useCloudSession();
  const signedIn = Boolean(session.user && session.token);
  const project = useCloudQuery<CloudProject | null>("projects:get", cloudProjectId && signedIn ? { projectId: cloudProjectId } : "skip");
  const stalled = useStalled(Boolean(url && signedIn && cloudProjectId) && project === undefined);
  if (!url) return <GateShell><NoServer /></GateShell>;
  if (!session.ready) return <GateShell><Loading label="Signing in" variant="page" /></GateShell>;
  if (!signedIn) return <GateShell><SignIn onLogin={session.login} label={label} /></GateShell>;
  if (!cloudProjectId) return <GateShell><SetUpProject projectName={projectName} label={label} link={link} /></GateShell>;
  if (stalled) return <GateShell><Stalled label={label} onRetry={onRetry} /></GateShell>;
  if (project === undefined) return <GateShell><Loading label={`Loading ${label.toLowerCase()}`} variant="page" /></GateShell>;
  if (project === null) {
    return <GateShell><EmptyState icon={<SearchX size={22} />} title={`No access to ${projectName}`} /></GateShell>;
  }
  return <Fragment key={JSON.stringify([url, session.user?._id, cloudProjectId])}>{children({ project, projectId: cloudProjectId, canEdit: project.memberRole !== "viewer", isAdmin: project.memberRole === "owner" || project.memberRole === "admin" })}</Fragment>;
}

function SetUpProject({ projectName, label, link }: { projectName: string; label: string; link?: ProjectLink }) {
  const teamId = link?.teamId ?? null;
  const linked = new Set(Object.values(useCloudLinks().projects));
  const existing = useCloudQuery<CloudProject[]>("projects:listForUser", teamId ? { teamId } : "skip")?.filter((project) => !linked.has(project._id));
  const [choice, setChoice] = useState("");
  const action = useAction();
  const create = () => action.run(async () => {
    if (!link || !teamId) return;
    const projectId = await cloudMutation<string>("projects:create", { teamId, name: projectName });
    await linkCloudRecord({ projects: { [link.botId]: projectId } });
  }, "Could not create the project");
  const attach = () => action.run(async () => {
    if (!link || !choice) return;
    await linkCloudRecord({ projects: { [link.botId]: choice } });
  }, "Could not link the project");
  const body = `${projectName} has no ${label.toLowerCase()} yet. Set up its shared project to track issues, assets, secrets and feedback with your team and its agents.`;
  if (!link || !teamId) {
    return <EmptyState icon={<FolderPlus size={22} />} title={`Set up ${projectName}`}
      body={`${body} Move ${projectName} into a shared workspace first.`} />;
  }
  return (
    <EmptyState icon={<FolderPlus size={22} />} title={`Set up ${projectName}`} body={body}
      action={(
        <div className="flex w-full max-w-sm flex-col items-stretch gap-3">
          <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void create()}>
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Create {projectName}
          </button>
          {existing && existing.length > 0 && (
            <div className="flex items-center gap-2">
              <Select className="min-w-0 flex-1" aria-label="Existing project" value={choice} onChange={(event) => setChoice(event.target.value)} disabled={action.busy}>
                <option value="">Link an existing project…</option>
                {existing.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
              </Select>
              <button type="button" className={ghostButton} disabled={!choice || action.busy} onClick={() => void attach()}><Link2 size={14} />Link</button>
            </div>
          )}
          {action.error && <Notice tone="danger">{action.error}</Notice>}
        </div>
      )} />
  );
}

export type WorkspaceContext = { teamId: string; me: CloudUser; role: WorkspaceRole; canEdit: boolean };

/** A workspace page's gate; `head` lets an unshared workspace create its shared workspace in place. */
type WorkspaceGateProps = { teamId: string | null; label: string; head?: { id: string; name: string }; children: (ctx: WorkspaceContext) => ReactNode };

export function WorkspaceGate(props: WorkspaceGateProps) {
  const [attempt, retry] = useRetry();
  return <CloudQueryBoundary key={props.teamId} label={props.label}><TeamGate key={attempt} {...props} onRetry={retry} /></CloudQueryBoundary>;
}

function TeamGate({ teamId, label, head, children, onRetry }: WorkspaceGateProps & { onRetry(): void }) {
  const url = useCloudUrl();
  const session = useCloudSession();
  const signedIn = Boolean(session.user && session.token);
  const access = useWorkspaceAccess(teamId && signedIn ? teamId : null);
  const stalled = useStalled(Boolean(url && signedIn && teamId) && access === undefined);
  if (!url) return <GateShell><NoServer /></GateShell>;
  if (!session.ready) return <GateShell><Loading label="Signing in" variant="page" /></GateShell>;
  if (!signedIn || !session.user) return <GateShell><SignIn onLogin={session.login} label={label} /></GateShell>;
  if (!teamId) return <GateShell><SetUpWorkspace label={label} head={head} /></GateShell>;
  if (stalled) return <GateShell><Stalled label={label} onRetry={onRetry} /></GateShell>;
  if (access === undefined) return <GateShell><Loading label={`Loading ${label.toLowerCase()}`} variant="page" /></GateShell>;
  if (access === null) {
    return <GateShell><EmptyState icon={<SearchX size={22} />} title="No access to this workspace" /></GateShell>;
  }
  return <Fragment key={JSON.stringify([url, session.user._id, teamId])}>{children({ teamId, me: session.user, role: access.role, canEdit: access.role !== "viewer" })}</Fragment>;
}

function SetUpWorkspace({ label, head }: { label: string; head?: { id: string; name: string } }) {
  const action = useAction();
  const create = () => action.run(async () => {
    if (!head) return;
    const { teamId } = await createOriginWorkspace(head.name);
    await linkCloudRecord({ workspaces: { [head.id]: teamId } });
  }, "Could not share the workspace");
  return (
    <EmptyState icon={<Users size={22} />} title="Share this workspace"
      body={`${label} are shared with the people in a workspace. Share ${head?.name ?? "this workspace"} to invite people and see its ${label.toLowerCase()} here.`}
      action={head && (
        <div className="flex flex-col items-center gap-2">
          <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void create()}>
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}Share {head.name}
          </button>
          {action.error && <Notice tone="danger">{action.error}</Notice>}
        </div>
      )} />
  );
}

function NoServer() {
  return <EmptyState icon={<ServerOff size={22} />} title="No workspace server" body="Choose a workspace server in Settings to see this page." />;
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
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center motion-safe:animate-pop-in" aria-label="Sign in to Origin">
      <IconTile><LogIn size={22} /></IconTile>
      <h2 className="text-[17px] font-semibold text-ink">Sign in to Origin</h2>
      <p className="max-w-sm text-[13px] text-ink-secondary">Your session ended. Sign in again to see {label.toLowerCase()}.</p>
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-2 text-left">
        <input className={inputClass} type="email" autoComplete="username" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={inputClass} type="password" autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <Notice tone="danger">{error}</Notice>}
        <button className={primaryButton} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}Sign in</button>
      </form>
    </section>
  );
}

function IconTile({ children }: { children: ReactNode }) {
  return <span className="flex size-12 items-center justify-center rounded-2xl border border-hairline/50 bg-raised/60 text-ink-secondary" aria-hidden="true">{children}</span>;
}

export function EmptyState({ icon, title, body, action, compact }: { icon: ReactNode; title: string; body?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <section className={cn("flex flex-1 flex-col items-center justify-center gap-2.5 text-center motion-safe:animate-pop-in", compact ? "px-4 py-8" : "p-6")}>
      <IconTile>{icon}</IconTile>
      <h2 className="mt-1 text-[15px] font-semibold text-ink">{title}</h2>
      {body && <p className="max-w-sm text-[13px] leading-relaxed text-ink-secondary">{body}</p>}
      {action && <div className="mt-2 flex w-full justify-center">{action}</div>}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block rounded-md bg-raised/70 motion-safe:animate-pulse", className)} />;
}

export type LoadingVariant = "page" | "list" | "board" | "grid" | "chat" | "inline";

/** A placeholder in the shape of what is loading, announced to screen readers by its label. */
export function Loading({ label, variant = "list" }: { label: string; variant?: LoadingVariant }) {
  const shape = variant === "board" ? (
    <div className="flex gap-3">
      {[3, 2, 1].map((cards, column) => (
        <div key={column} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-inset/60 p-2">
          <Skeleton className="m-1 h-4 w-24" />
          {Array.from({ length: cards }, (_, card) => <Skeleton key={card} className="h-[84px] rounded-xl" />)}
        </div>
      ))}
    </div>
  ) : variant === "grid" ? (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}
    </div>
  ) : variant === "chat" ? (
    <div className="flex flex-col gap-4">
      {["w-2/3", "w-2/5", "w-4/5"].map((width, index) => (
        <div key={index} className="flex gap-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3 w-24" /><Skeleton className={cn("h-3", width)} /></div>
        </div>
      ))}
    </div>
  ) : variant === "inline" ? (
    <div className="flex flex-col gap-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
  ) : (
    <div className="flex flex-col gap-2">
      {variant === "page" && <div className="mb-3 flex items-center gap-3"><Skeleton className="h-6 w-32" /><Skeleton className="ml-auto h-8 w-28" /></div>}
      {Array.from({ length: variant === "page" ? 5 : 4 }, (_, index) => <Skeleton key={index} className="h-11 rounded-lg" />)}
    </div>
  );
  return (
    <div role="status" aria-live="polite" className={cn("min-h-0", variant === "inline" ? "py-2" : "flex-1 overflow-hidden px-4 py-5 md:px-6")}>
      <span className="sr-only">{label}</span>
      {shape}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "danger"; children: ReactNode }) {
  return (
    <p role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-lg px-3 py-2 text-[12.5px] motion-safe:animate-pop-in", tone === "danger" ? "bg-danger/10 text-danger" : "bg-raised/60 text-ink-secondary")}>
      {children}
    </p>
  );
}

export function ReadOnlyEditorNotice({ canEdit }: { canEdit: boolean }) {
  return canEdit ? null : <Notice>Editing access changed. Your draft is kept, but your current role cannot save it.</Notice>;
}

/** A page's header row once it sits in the glass above the page, lined up with the page's own gutters. */
export const glassHeaderRow = "px-4 pb-3 md:px-6";

export function PageHeader({ title, count, children }: { title: string; count?: ReactNode; children?: ReactNode }) {
  const pinned = useInGlassHeader();
  return (
    <GlassHeader>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", pinned ? glassHeaderRow : "mb-4")}>
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {count !== undefined && <span className="text-[13px] tabular-nums text-ink-tertiary">{count}</span>}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{children}</div>
      </div>
    </GlassHeader>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-[12px] text-ink-secondary", className)}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Modal({ title, onClose, canClose, children, wide, className }: { title: ReactNode; onClose(): void; canClose?(): boolean; children: ReactNode; wide?: boolean; className?: string }) {
  const heading = useId();
  return (
    <CenteredDialog label={typeof title === "string" ? title : "Dialog"} labelledBy={heading} onClose={onClose} canClose={canClose}
      className={cn(wide ? "sm:max-w-4xl" : "sm:max-w-md", className)}>
      {(dismiss) => <>
        <div className="flex items-center gap-2 px-4 pb-2 pt-3">
          <h3 id={heading} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-secondary">{title}</h3>
          <button type="button" className={iconButton} aria-label="Close" onClick={dismiss}><X size={16} /></button>
        </div>
        <div className="px-4 pb-4"><CloudQueryRefreshNotice className="mb-3" />{children}</div>
      </>}
    </CenteredDialog>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: NoInfer<T>; label: ReactNode; title?: string }[]; onChange(value: NoInfer<T>): void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg bg-inset p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} title={option.title} onClick={() => onChange(option.value)}
          className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-ink-secondary transition-colors hover:text-ink", focusRing, option.value === value && "bg-raised text-ink")}>
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
