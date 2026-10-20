import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Select } from "../Select";
import { Check, GitBranch, Link2, Loader2, Palette, RotateCcw, Settings, Trash2, UserPlus, Users } from "lucide-react";
import { ZAP_SWATCHES, setAvatarLook, useAvatarLook, useBotColor } from "@/lib/origin-avatar-looks";
import { botPalette } from "@/lib/user-bubble-tone";
import { useStore } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { originGitHub, type GitHubProjectConnection, type GitHubWorkspaceStatus } from "@/lib/origin-github";
import { cn } from "@/lib/cn";
import type { CloudPerson, CloudProject, CloudProjectMember, GitHubTaskMode, MemberRole } from "./cloud-types";
import { githubRepoHref } from "./repo-url";
import { ProjectAccessCard } from "../origin-members/ProjectAccessCard";
import { ChiefHeartbeatCard } from "./ChiefHeartbeatCard";
import { CloudGate, Field, Loading, Notice, PageHeader, cardClass, ghostButton, iconButton, inputClass, pageClass, primaryButton, useAction, type OriginPageProps } from "./ui";

type IconType = NonNullable<CloudProject["iconType"]>;
type TaskPRColumn = { id: string; title: string; isDone: boolean };

export function ProjectSettingsPage(props: OriginPageProps) {
  const botId = props.link?.botId;
  return (
    <CloudGate {...props} label="Settings">
      {({ project, projectId, isAdmin }) => (
        <section className={pageClass} aria-label="Project settings">
          <PageHeader title="Settings" />
          <div className="grid min-w-0 max-w-5xl gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <GeneralSettings key={projectId} project={project} projectId={projectId} isAdmin={isAdmin}
                accent={botId ? <ProjectAccent botId={botId} /> : null} />
              <GitHubSettings key={`${projectId}:${project.githubTaskMode ?? ""}`} project={project} projectId={projectId} isAdmin={isAdmin} />
              <GitHubConnectionCard project={project} projectId={projectId} isAdmin={isAdmin} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <ProjectAccessCard projectId={projectId} teamId={project.teamId} />
              <Members project={project} projectId={projectId} isAdmin={isAdmin} />
              {project.teamId && <ChiefHeartbeatCard projectId={projectId} />}
            </div>
          </div>
        </section>
      )}
    </CloudGate>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={cn(cardClass, "p-4")}>
      <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-ink"><span className="text-ink-secondary">{icon}</span>{title}</h3>
      {children}
    </section>
  );
}

/** The project's accent is its lead bot's colour: this shows it and changes it for the whole app, not only these pages. */
function ProjectAccent({ botId }: { botId: string }) {
  const { state } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const look = useAvatarLook(botId);
  const color = botPalette(useBotColor(bot));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = (next: string | null) => {
    setError("");
    setSaving(true);
    void setAvatarLook(botId, { color: next })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false));
  };
  const custom = Boolean(look.color && !(ZAP_SWATCHES as readonly string[]).some((swatch) => swatch.toLowerCase() === look.color?.toLowerCase()));
  const swatch = "relative size-7 shrink-0 rounded-full outline-none transition-transform duration-(--motion-fast) hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:opacity-50 motion-reduce:hover:scale-100";
  const chosen = "ring-2 ring-ink ring-offset-2 ring-offset-panel";
  return (
    <div role="group" aria-label="Accent colour" className="flex flex-col gap-2 rounded-xl border border-hairline/40 bg-inset/60 p-3">
      <div className="flex items-center gap-2.5">
        <span className="size-5 shrink-0 rounded-full transition-colors duration-(--motion-fast)" style={{ background: color }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-ink">Accent <span className="font-mono text-[11.5px] uppercase text-ink-tertiary">{color}</span></span>
        </span>
        {look.color && (
          <button type="button" onClick={() => save(null)} disabled={saving} title="Use the mascot colour"
            className="flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
            <RotateCcw size={12} />Mascot colour
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ZAP_SWATCHES.map((value) => {
          const active = look.color?.toLowerCase() === value.toLowerCase();
          return <button key={value} type="button" disabled={saving} aria-pressed={active} aria-label={`Use ${value}`} title={value} onClick={() => save(value)}
            className={cn(swatch, active && chosen)} style={{ background: value }} />;
        })}
        <label title="Custom colour" className={cn(swatch, "flex cursor-pointer items-center justify-center overflow-hidden border border-dashed border-hairline text-ink-secondary", custom && cn("border-solid", chosen))}
          style={custom ? { background: look.color } : undefined}>
          {!custom && <Palette size={13} aria-hidden="true" />}
          <input type="color" aria-label="Custom accent colour" value={botPalette(look.color ?? color)} disabled={saving}
            onChange={(event) => save(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        {saving && <Loader2 size={14} className="animate-spin text-ink-tertiary" aria-label="Saving" />}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

function ProjectGlyph({ project, iconType, iconValue }: { project: CloudProject; iconType: IconType; iconValue: string }) {
  const base = "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-[18px] font-semibold";
  if (iconType === "image" && project.iconUrl) return <img src={project.iconUrl} alt="" className={cn(base, "object-cover")} />;
  if (iconType === "emoji" && iconValue) return <span className={cn(base, "bg-raised")}>{iconValue}</span>;
  return <span className={cn(base, "bg-accent text-accent-ink transition-colors duration-(--motion-fast)")}>{project.name.slice(0, 1).toUpperCase()}</span>;
}

function GeneralSettings({ project, projectId, isAdmin, accent }: { project: CloudProject; projectId: string; isAdmin: boolean; accent: ReactNode }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [repoUrl, setRepoUrl] = useState(project.repoUrl ?? "");
  const [iconType, setIconType] = useState<IconType>(project.iconType ?? "default");
  const [iconValue, setIconValue] = useState(project.iconType === "emoji" || project.iconType === "icon" ? project.iconValue ?? "" : "");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const remote = JSON.stringify([project.name, project.description ?? "", project.repoUrl ?? "", project.iconType ?? "default", project.iconValue ?? ""]);
  useEffect(() => {
    if (dirty) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setRepoUrl(project.repoUrl ?? "");
    setIconType(project.iconType ?? "default");
    setIconValue(project.iconType === "emoji" || project.iconType === "icon" ? project.iconValue ?? "" : "");
  }, [remote, dirty]);
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const ok = await action.run(async () => {
      let iconStorageId: string | undefined;
      if (iconType === "image" && iconFile) {
        const uploadUrl = await cloudMutation<string>("projects:generateIconUploadUrl", { projectId });
        const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": iconFile.type || "application/octet-stream" }, body: iconFile });
        if (!response.ok) throw new Error("Icon upload failed");
        iconStorageId = ((await response.json()) as { storageId: string }).storageId;
      }
      await cloudMutation("projects:update", {
        projectId, name, description, repoUrl, iconType,
        ...(iconType === "emoji" || iconType === "icon" ? { iconValue } : {}),
        ...(iconStorageId ? { iconStorageId } : {}),
      });
    }, "Could not save project");
    if (ok) { setIconFile(null); setSaved(true); setDirty(false); }
  };
  const toggleStatus = () => void action.run(() => cloudMutation("projects:update", { projectId, status: project.status === "active" ? "inactive" : "active" }), "Could not update project");
  const repoHref = githubRepoHref(repoUrl);
  return (
    <Card icon={<Settings size={15} />} title="Project">
      {accent && <div className="mb-3">{accent}</div>}
      <form onSubmit={save} onChange={() => { setSaved(false); setDirty(true); }} className="flex flex-col gap-3">
        <fieldset disabled={!isAdmin || action.busy} className="flex min-w-0 flex-col gap-3">
          <div className="flex items-end gap-3">
            <ProjectGlyph project={project} iconType={iconType} iconValue={iconValue} />
            <Field label="Icon" className="flex-1">
              <Select className="w-full" value={iconType} onChange={(e) => setIconType(e.target.value as IconType)}>
                <option value="default">Accent initial</option>
                <option value="emoji">Emoji</option>
                <option value="icon">Icon name</option>
                <option value="image">Upload image</option>
              </Select>
            </Field>
            {(iconType === "emoji" || iconType === "icon") && (
              <Field label={iconType === "emoji" ? "Emoji" : "Icon name"} className="w-28">
                <input className={inputClass} value={iconValue} onChange={(e) => setIconValue(e.target.value)} maxLength={64} required placeholder={iconType === "emoji" ? "🚀" : "circle"} />
              </Field>
            )}
          </div>
          {iconType === "image" && <Field label="Picture"><input className={inputClass} type="file" accept="image/*" onChange={(e) => setIconFile(e.target.files?.[0] ?? null)} /></Field>}
          <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></Field>
          <Field label="Description"><textarea className={inputClass} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="GitHub repository">
            <input className={inputClass} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo or owner/repo" />
          </Field>
          {repoUrl && !repoHref && <p className="text-[12px] text-warning">This does not look like a GitHub repository.</p>}
        </fieldset>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <button className={primaryButton} disabled={action.busy || !name.trim()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}{saved ? "Saved" : "Save project"}</button>
            <button type="button" role="switch" aria-checked={project.status === "active"} disabled={action.busy} onClick={toggleStatus}
              className="ml-auto flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-raised">
              <span className={cn("relative h-4 w-7 rounded-full transition-colors", project.status === "active" ? "bg-success" : "bg-raised")}>
                <span className={cn("absolute top-0.5 size-3 rounded-full bg-white transition-all", project.status === "active" ? "left-3.5" : "left-0.5")} />
              </span>
              {project.status === "active" ? "Active" : "Inactive"}
            </button>
          </div>
        ) : <Notice>Only project owners and admins can change these settings.</Notice>}
      </form>
    </Card>
  );
}

function GitHubSettings({ project, projectId, isAdmin }: { project: CloudProject; projectId: string; isAdmin: boolean }) {
  const columns = useCloudQuery<TaskPRColumn[]>("taskPRs:columns", { projectId });
  const [mode, setMode] = useState<GitHubTaskMode>(project.githubTaskMode ?? "issue");
  const [review, setReview] = useState(project.githubReviewColumnId === undefined ? "" : project.githubReviewColumnId ?? "none");
  const [done, setDone] = useState(project.githubDoneColumnId ?? "auto");
  const [notice, setNotice] = useState("");
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    const ok = await action.run(() => cloudMutation("taskPRs:configure", {
      projectId, mode,
      ...(review ? { reviewColumnId: review === "none" ? null : review } : {}),
      ...(done === "auto" ? {} : { doneColumnId: done }),
    }), "Could not save settings");
    if (ok) setNotice("GitHub task settings saved");
  };
  return (
    <Card icon={<GitBranch size={15} />} title="Tasks on GitHub">
      <form onSubmit={save} className="flex flex-col gap-3">
        <fieldset disabled={!isAdmin || action.busy} className="flex flex-col gap-3">
          <Field label="Create tasks as">
            <Select className="w-full" value={mode} onChange={(e) => setMode(e.target.value as GitHubTaskMode)}>
              <option value="issue">GitHub issues</option>
              <option value="pull_request">Draft pull requests with task branches</option>
            </Select>
          </Field>
          <Field label="In review column">
            <Select className="w-full" value={review} required={mode === "pull_request"} onChange={(e) => setReview(e.target.value)}>
              <option value="" disabled>Choose a column or keep the current column</option>
              <option value="none">Keep current column</option>
              {columns?.filter((column) => !column.isDone).map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
            </Select>
          </Field>
          <Field label="Done column on merge">
            <Select className="w-full" value={done} onChange={(e) => setDone(e.target.value)}>
              <option value="auto">Use Done (create if missing)</option>
              {columns?.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
            </Select>
          </Field>
        </fieldset>
        <p className="text-[12px] text-ink-tertiary">Pull request tasks are completed when their PR merges. Drafts start with a task plan commit.</p>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        {isAdmin && <button className={cn(primaryButton, "self-start")} disabled={action.busy || !columns || !project.repoUrl} title={!project.repoUrl ? "Link a repository first" : undefined}>Save GitHub settings</button>}
      </form>
    </Card>
  );
}

function useGitHubStatus(teamId: string | undefined, projectId: string) {
  const [workspace, setWorkspace] = useState<GitHubWorkspaceStatus | null>(null);
  const [connection, setConnection] = useState<GitHubProjectConnection | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [status, project] = await Promise.all([
        teamId ? originGitHub.workspace(teamId) : Promise.resolve(null),
        originGitHub.connection(projectId).catch(() => ({ connection: null })),
      ]);
      setWorkspace(status);
      setConnection(project.connection);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the GitHub connection");
    }
  }, [teamId, projectId]);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { workspace, connection, error, refresh, setConnection };
}

function GitHubConnectionCard({ project, projectId, isAdmin }: { project: CloudProject; projectId: string; isAdmin: boolean }) {
  const { workspace, connection, error, refresh, setConnection } = useGitHubStatus(project.teamId, projectId);
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const action = useAction();
  const teamId = project.teamId;
  const run = async (fn: () => Promise<unknown>, fallback: string, done = "") => {
    setNotice("");
    if (await action.run(fn, fallback)) {
      if (done) setNotice(done);
      await refresh();
    }
  };
  const saveToken = async (event: FormEvent) => {
    event.preventDefault();
    await run(async () => { setConnection((await originGitHub.saveToken(projectId, token.trim())).connection); setToken(""); }, "Could not save the token", "GitHub token saved for this project");
  };
  return (
    <Card icon={<Link2 size={15} />} title="GitHub connection">
      <div className="flex flex-col gap-3 text-[13px]">
        {error && <Notice tone="danger">{error}</Notice>}
        {!teamId ? <Notice>This project is not in a shared workspace yet.</Notice> : workspace === null ? <Loading label="Reading GitHub connection" variant="inline" /> : (
          <>
            <p className="text-ink-secondary">
              {workspace.login ? <>Workspace connected as <strong className="text-ink">@{workspace.login}</strong>.</> : "This workspace has not connected GitHub."}
            </p>
            {!workspace.configured && (workspace.canSetup
              ? <Notice>Create the GitHub App once for this server; GitHub opens in your browser.</Notice>
              : <Notice>A server administrator has not set up the GitHub App yet.</Notice>)}
            {project.githubTaskMode === "pull_request" && workspace.prPermissionNotice && <Notice>{workspace.prPermissionNotice}</Notice>}
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                {!workspace.configured && workspace.canSetup && <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void run(() => originGitHub.setupApp(teamId), "Could not start the App setup", "Finish creating the App in your browser, then come back here.")}>Create GitHub App</button>}
                {workspace.configured && <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void run(() => originGitHub.connectWorkspace(teamId, projectId), "Could not connect GitHub", "Finish connecting in your browser, then come back here.")}>{workspace.login ? "Reconnect GitHub" : "Connect GitHub"}</button>}
                {workspace.login && <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void run(() => originGitHub.disconnectWorkspace(teamId), "Could not disconnect GitHub", "GitHub disconnected from this workspace")}>Disconnect</button>}
                {!project.repoUrl && workspace.login && <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void run(async () => {
                  const result = await originGitHub.createRepository(teamId, projectId);
                  if (result.state === "error") throw new Error(result.error ?? "Repository creation failed");
                }, "Could not create the repository", "Creating a private repository for this project")}>Create repository</button>}
              </div>
            )}
          </>
        )}
        {project.repoUrl && (
          <form onSubmit={saveToken} className="flex flex-col gap-2 border-t border-hairline/30 pt-3">
            <p className="text-ink-secondary">
              {connection ? <>This project uses {connection.source === "project" ? "a personal access token of" : "the workspace connection of"} <strong className="text-ink">@{connection.login}</strong>.</> : "This project has no GitHub access of its own."}
            </p>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <input className={cn(inputClass, "min-w-[200px] flex-1")} type="password" autoComplete="off" placeholder="Fine-grained access token for this repository" aria-label="GitHub access token" value={token} onChange={(e) => setToken(e.target.value)} />
                <button className={ghostButton} disabled={action.busy || !token.trim()}>Save token</button>
                {connection?.source === "project" && <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void run(() => originGitHub.removeToken(projectId), "Could not remove the token", "Token removed")}>Remove token</button>}
              </div>
            )}
          </form>
        )}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
      </div>
    </Card>
  );
}

const ROLES: readonly MemberRole[] = ["owner", "admin", "member", "viewer"];

function Members({ project, projectId, isAdmin }: { project: CloudProject; projectId: string; isAdmin: boolean }) {
  const people = useCloudQuery<CloudPerson[]>("members:people", { projectId });
  const rows = useCloudQuery<CloudProjectMember[]>("members:list", { projectId });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const action = useAction();
  const projectRows = new Map((rows ?? []).map((row) => [row.email, row]));
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await action.run(() => cloudMutation("members:addWorkspaceMember", { projectId, email: email.trim(), role }), "Could not add member")) setEmail("");
  };
  return (
    <Card icon={<Users size={15} />} title={`Members${people ? ` · ${people.length}` : ""}`}>
      {people === undefined ? <Loading label="Loading members" variant="inline" /> : (
        <ul className="flex flex-col divide-y divide-hairline/30">
          {people.map((person) => {
            const row = projectRows.get(person.email);
            const editable = isAdmin && row && row.role !== "owner";
            return (
              <li key={person._id} className="flex items-center gap-3 py-2">
                {person.avatarUrl
                  ? <img src={person.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                  : <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold text-ink-secondary">{(person.name || person.email).slice(0, 1).toUpperCase()}</span>}
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[13px] font-medium text-ink">{person.name}</strong>
                  <small className="block truncate text-[12px] text-ink-tertiary">{person.email}</small>
                </div>
                {editable ? (
                  <>
                    <Select size="sm" aria-label={`Role for ${person.name}`} value={row.role} disabled={action.busy}
                      onChange={(e) => void action.run(() => cloudMutation("members:updateRole", { projectId, memberId: row._id, role: e.target.value }), "Could not change role")}>
                      {ROLES.map((value) => <option key={value} value={value}>{value}</option>)}
                    </Select>
                    <button type="button" className={iconButton} aria-label={`Remove ${person.name}`} title="Remove from project" disabled={action.busy}
                      onClick={() => { if (window.confirm(`Remove ${person.name} from ${project.name}?`)) void action.run(() => cloudMutation("members:remove", { projectId, memberId: row._id }), "Could not remove member"); }}>
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : <span className="text-[12px] capitalize text-ink-tertiary">{person.role}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {isAdmin && project.teamId && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2 border-t border-hairline/40 pt-3">
          <Field label="Add a workspace member" className="min-w-[180px] flex-1">
            <input className={inputClass} type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Select size="sm" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "member" | "viewer")}>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </Select>
          <button className={primaryButton} disabled={action.busy}><UserPlus size={14} />Add</button>
        </form>
      )}
      {action.error && <div className="mt-2"><Notice tone="danger">{action.error}</Notice></div>}
    </Card>
  );
}
