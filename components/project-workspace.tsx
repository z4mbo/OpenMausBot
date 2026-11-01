"use client";
import { errorText } from "@/lib/error-text";
import { useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import { CircleDot, ExternalLink, GitBranch, GitCommit, Power, RotateCcw, Settings } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { localApi } from "@/lib/client-api";
import { normalizeProjectEmoji } from "@/lib/project-emoji";
import { BoardTab } from "./project-issues";
import { TaskModal } from "./issue-detail";
import { IssueComposer } from "./issue-composer";
import { RepositoryProvisioning } from "./repository-provisioning";
import { RepositorySettings } from "./repository-settings";
import { ProjectIcon, ProjectIconPicker } from "./project-icon";
import { ProjectMembers } from "./project-members";
import { AssetsPanel, VaultPanel } from "./project-library";
import { ContentSkeleton } from "./content-skeleton";
import { useContentTransition } from "./use-content-transition";
import type { AuthUser } from "./origin-app";

const FeedbackView = dynamic(() => import("./feedback-view").then(module => module.FeedbackView), { loading: () => <ContentSkeleton rows={6} /> });

type TabKey = "board" | "repo" | "assets" | "vault" | "feedback" | "settings";
type ProjectIconType = "default" | "emoji" | "icon" | "image";
type GitHubSnapshot = {
  repo: string;
  tokenConfigured: boolean;
  commits: Array<{ sha: string; message: string; author: string; url: string; committedAt: number }>;
  commitsError: string;
  issues: Array<{ number: number; title: string; state: "open" | "closed"; url: string; author?: string; updatedAt: number }>;
  pullRequests: Array<{ number: number; title: string; state: "open" | "closed" | "merged"; url: string; author?: string; branch?: string; updatedAt: number }>;
  hosted: "origin-local";
};
type ProjectWithUi = Doc<"projects"> & { memberRole: string; iconUrl?: string | null; openIssueCount?: number };
type AvatarUser = { username?: string; name: string; email: string; avatarUrl?: string | null };

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "board", label: "Issues" },
  { key: "assets", label: "Assets" },
  { key: "vault", label: "Vault" },
  { key: "repo", label: "Repo" },
  { key: "feedback", label: "Feedback" },
  { key: "settings", label: "Settings" },
];
function fmtDate(timestamp?: number) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}
function shortSha(sha: string) {
  return sha.startsWith("manual-") ? "manual" : sha.slice(0, 7);
}
function parseGitHubRepo(repoUrl?: string) {
  if (!repoUrl) return null;
  const value = repoUrl.trim();
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, "") };
  const match = value.match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}
function githubRepoHref(repoUrl?: string) {
  const parsed = parseGitHubRepo(repoUrl);
  return parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null;
}
function LoadingState({ label = "Loading" }: { label?: string }) {
  return <ContentSkeleton label={label} kind={label.includes("board") || label.includes("project") ? "board" : "list"} rows={4} />;
}

function useGitHubSnapshot(projectId: Id<"projects">, repoUrl: string | undefined, sessionToken: string, revision = 0) {
  const [snapshot, setSnapshot] = useState<GitHubSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!repoUrl) {
      setSnapshot(null);
      setError("");
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    localApi<GitHubSnapshot>(`/api/github/repo?projectId=${projectId}`, sessionToken)
      .then((result) => {
        if (alive) setSnapshot(result);
      })
      .catch((issue) => {
        if (alive) {
          setSnapshot(null);
          setError(errorText(issue, "GitHub sync failed"));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, repoUrl, sessionToken, revision]);
  return { snapshot, error, loading };
}

export function ProjectWorkspace({ projectId, sessionToken, user, viewers, initialTaskId, onOpenReference }: { projectId: Id<"projects">; sessionToken: string; user: AuthUser; viewers: Array<AvatarUser & { userId: string }>; initialTaskId?: Id<"tasks">; onOpenReference: (projectId: Id<"projects">, taskId?: Id<"tasks">) => void }) {
  const [tab, setTab] = useState<TabKey>("board");
  useEffect(() => { const value = new URLSearchParams(window.location.search).get("tab"); setTab(value === "team" ? "settings" : tabs.some(tab => tab.key === value) ? value as TabKey : "board"); }, [projectId]);
  const tabLoading = useContentTransition(`${projectId}:${tab}`);
  const [issueOpen, setIssueOpen] = useState(false);
  const [pendingTask, setPendingTask] = useState(initialTaskId);
  const [feedbackTask, setFeedbackTask] = useState<Id<"tasks"> | null>(null);
  const project = useQuery(api.projects.get, { projectId, sessionToken });
  const openTab = (key: TabKey) => { setTab(key); setPendingTask(undefined); const params = new URLSearchParams(window.location.search); params.set("tab", key); params.delete("issue"); window.history.replaceState(null, "", `${location.pathname}?${params}`); };
  if (!project) return <LoadingState label="Opening project" />;
  return (
    <div className={clsx("project-shell", tabLoading && "tab-loading")} aria-busy={tabLoading}>
      {tabLoading && <div className="view-loading-overlay"><ContentSkeleton kind={tab === "board" ? "board" : "list"} label="Loading project view" /></div>}
      <div className="project-navigation"><div className="project-identity"><ProjectIcon project={project} /><strong>{project.name}</strong></div><nav className="tabs" aria-label="Project views"><span className="tab-glider" aria-hidden="true" />{tabs.filter(item => item.key !== "settings").map(item => <button key={item.key} aria-current={tab === item.key ? "page" : undefined} className={clsx(tab === item.key && "active")} onClick={() => openTab(item.key)}>{item.label}</button>)}</nav><button className={clsx("icon-button project-settings-tab", tab === "settings" && "selected")} aria-label="Settings" title="Project settings" aria-pressed={tab === "settings"} onClick={() => openTab("settings")}><Settings size={16} /></button></div>
      {project.status !== "active" && <ProjectStateBanner project={project} sessionToken={sessionToken} />}
      {tab === "board" ? <BoardTab key={projectId} project={project} projectId={projectId} sessionToken={sessionToken} userEmail={user.email} canEdit={project.memberRole !== "viewer"} onCreateIssue={() => setIssueOpen(true)} initialTaskId={pendingTask} onOpenReference={onOpenReference} /> : null}
      {tab === "repo" ? <RepoTab project={project} sessionToken={sessionToken} /> : null}
      {tab === "assets" ? <AssetsPanel projectId={projectId} sessionToken={sessionToken} /> : null}
      {tab === "vault" ? <VaultPanel projectId={projectId} sessionToken={sessionToken} /> : null}
      {tab === "feedback" ? <FeedbackView key={projectId} projectId={projectId} sessionToken={sessionToken} onOpenTask={(_, taskId) => setFeedbackTask(taskId)} /> : null}
      {tab === "settings" ? <SettingsTab project={project} sessionToken={sessionToken} /> : null}
      {feedbackTask && <TaskModal project={project} projectId={projectId} sessionToken={sessionToken} taskId={feedbackTask} canEdit={project.memberRole !== "viewer"} onClose={() => setFeedbackTask(null)} />}
      {issueOpen && <IssueComposer sessionToken={sessionToken} activeProjectId={projectId} projects={[project]} onClose={() => setIssueOpen(false)} onCreated={() => setTab("board")} />}
    </div>
  );
}
function StatPill({ label, value }: { label: string; value: string | number }) { return <div className="stat-pill"><span>{label}</span><strong>{value}</strong></div>; }

function ProjectStateBanner({ project, sessionToken }: { project: ProjectWithUi; sessionToken: string }) {
  const update = useMutation(api.projects.update);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="project-state-banner inactive"><Power size={14} /><span>Inactive</span>{["owner", "admin"].includes(project.memberRole) && <button className="icon-button" aria-label="Reactivate project" title="Reactivate project" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await update({ sessionToken, projectId: project._id, status: "active" }); } catch (error) { setError(errorText(error, "Could not reactivate")); } finally { setBusy(false); } }}><RotateCcw size={16} /></button>}{error && <span role="alert">{error}</span>}</div>;
}

function SettingsTab({ project, sessionToken }: { project: ProjectWithUi; sessionToken: string }) {
  const updateProject = useMutation(api.projects.update);
  const generateIconUploadUrl = useMutation(api.projects.generateIconUploadUrl);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [repoUrl, setRepoUrl] = useState(project.repoUrl || "");
  const [iconType, setIconType] = useState<ProjectIconType>((project.iconType as ProjectIconType | undefined) || "default");
  const [iconEmoji, setIconEmoji] = useState(project.iconType === "emoji" ? project.iconValue || "" : "");
  const [iconName, setIconName] = useState((project.iconType === "icon" ? project.iconValue : "circle") || "circle");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setName(project.name);
    setDescription(project.description || "");
    setRepoUrl(project.repoUrl || "");
    setIconType((project.iconType as ProjectIconType | undefined) || "default");
    setIconEmoji(project.iconType === "emoji" ? project.iconValue || "" : "");
    setIconName((project.iconType === "icon" ? project.iconValue : "circle") || "circle");
  }, [project._id, project.description, project.iconType, project.iconValue, project.name, project.repoUrl]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
    if (!name.trim()) throw new Error("Project name is required");
    let iconStorageId: Id<"_storage"> | undefined;
    if (iconType === "image" && iconFile) {
      const uploadUrl = await generateIconUploadUrl({ projectId: project._id, sessionToken });
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": iconFile.type || "application/octet-stream" }, body: iconFile });
      if (!res.ok) throw new Error("Icon upload failed");
      const payload = (await res.json()) as { storageId: Id<"_storage"> };
      iconStorageId = payload.storageId;
    }
    await updateProject({
      projectId: project._id,
      sessionToken,
      name,
      description,
      repoUrl,
      iconType,
      ...(iconType === "emoji" ? { iconValue: normalizeProjectEmoji(iconEmoji) } : {}),
      ...(iconType === "icon" ? { iconValue: iconName } : {}),
      ...(iconStorageId ? { iconStorageId } : {}),
    });
    setIconFile(null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
    } catch (error) { setError(errorText(error, "Could not save project")); }
    finally { setBusy(false); }
  };
  if (!["owner", "admin"].includes(project.memberRole)) return <ProjectMembers projectId={project._id} sessionToken={sessionToken} />;
  return <div className="project-settings-layout"><form className="panel stack-form" onSubmit={submit}>
    <div className="project-icon-settings">
      <ProjectIcon project={{ ...project, iconType, iconValue: iconType === "emoji" ? iconEmoji : iconName }} size={22} />
      <label>Icon type<select value={iconType} onChange={e => setIconType(e.target.value as ProjectIconType)}><option value="default">Default icon</option><option value="emoji">Emoji</option><option value="icon">Icon library</option><option value="image">Upload image</option></select></label>
      {iconType === "emoji" && <label>Emoji<input value={iconEmoji} onChange={e => setIconEmoji(e.target.value)} placeholder="🚀" maxLength={64} required /></label>}
      {iconType === "image" && <label>Picture<input type="file" accept="image/*" onChange={e => setIconFile(e.target.files?.[0] ?? null)} /></label>}
    </div>
    {iconType === "icon" && <ProjectIconPicker value={iconName} onChange={setIconName} />}
    <label>Name<input value={name} onChange={e => setName(e.target.value)} required /></label>
    <label>GitHub repo URL<input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/org/repo or org/repo" /></label>
    <label>Brief<textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} /></label>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <button className="primary-button" disabled={busy}>{busy ? "Saving..." : saved ? "Saved" : "Save project"}</button>
    <div className="project-lifecycle-actions"><span>Project status</span><button className="project-active-toggle" type="button" role="switch" aria-checked={project.status === "active"} aria-label="Active project" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await updateProject({ projectId: project._id, sessionToken, status: project.status === "active" ? "inactive" : "active" }); } catch (error) { setError(errorText(error, "Could not update project")); } finally { setBusy(false); } }}><span aria-hidden="true" />{project.status === "active" ? "Active" : "Inactive"}</button></div>
  </form><ProjectMembers projectId={project._id} sessionToken={sessionToken} /></div>;
}

function RepoTab({ project, sessionToken }: { project: Doc<"projects"> & { memberRole: string }; sessionToken: string }) {
  const savedCommits = useQuery(api.commits.list, { projectId: project._id, sessionToken });
  const [revision, setRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const github = useGitHubSnapshot(project._id, project.repoUrl, sessionToken, revision);
  const commits = github.snapshot?.commits ?? savedCommits;
  return (
    <section className="repo-dashboard">
      {project.repoUrl ? <div className="repo-address-row"><a href={githubRepoHref(project.repoUrl) || project.repoUrl} target="_blank" rel="noreferrer"><GitBranch size={16} /><span>{githubRepoHref(project.repoUrl)?.replace("https://github.com/", "") || project.repoUrl}</span><ExternalLink size={13} /></a>{["owner", "admin"].includes(project.memberRole) && <button className="icon-button" title="Repository settings" aria-label="Repository settings" onClick={() => setSettingsOpen(true)}><Settings size={16} /></button>}</div>
        : <div className="repo-empty"><GitBranch size={20} /><h3>No repository</h3><RepositoryProvisioning project={project} sessionToken={sessionToken} />{["owner", "admin"].includes(project.memberRole) && <button className="ghost-button compact" onClick={() => setSettingsOpen(true)}>Link a repository</button>}</div>}
      {github.error && <div className="notice danger">{github.error}{["owner", "admin"].includes(project.memberRole) && <button className="ghost-button compact" onClick={() => setSettingsOpen(true)}>Connection settings</button>}</div>}
      {github.snapshot?.commitsError && <div className="notice">{github.snapshot.commitsError}</div>}
      {project.repoUrl && <div className="repository-columns">
        <section className="repository-column"><header><GitCommit size={16} /><strong>Commits</strong><span>{commits?.length ?? ""}</span></header>{github.loading ? <ContentSkeleton rows={4} /> : !commits?.length ? <div className="repository-empty">No commits yet</div> : commits.map(commit => <a className="repository-item" key={commit.sha} href={commit.url || githubRepoHref(project.repoUrl)!} target="_blank" rel="noreferrer"><strong>{commit.message.split("\n")[0]}</strong><span><code>{shortSha(commit.sha)}</code><span>{commit.author}</span></span><time>{fmtDate(commit.committedAt)}</time></a>)}</section>
        <section className="repository-column"><header><CircleDot size={16} /><strong>Issues</strong><span>{github.snapshot?.issues.length ?? ""}</span></header>{github.loading ? <ContentSkeleton rows={4} /> : !github.snapshot?.issues.length ? <div className="repository-empty">{github.error ? "Issues unavailable" : "No issues yet"}</div> : github.snapshot.issues.map(issue => <a className="repository-item" key={issue.number} href={issue.url} target="_blank" rel="noreferrer"><strong>{issue.title}</strong><span><code>#{issue.number}</code><span className={`repository-state ${issue.state}`}>{issue.state}</span></span><time>{fmtDate(issue.updatedAt)}</time></a>)}</section>
        <section className="repository-column"><header><GitBranch size={16} /><strong>Pull requests</strong><span>{github.snapshot?.pullRequests.length ?? ""}</span></header>{github.loading ? <ContentSkeleton rows={4} /> : !github.snapshot?.pullRequests.length ? <div className="repository-empty">{github.error ? "Pull requests unavailable" : "No pull requests yet"}</div> : github.snapshot.pullRequests.map(pr => <a className="repository-item" key={pr.number} href={pr.url} target="_blank" rel="noreferrer"><strong>{pr.title}</strong><span><code>#{pr.number}</code><span className={`repository-state ${pr.state}`}>{pr.state}</span></span><time>{fmtDate(pr.updatedAt)}</time></a>)}</section>
      </div>}
      {settingsOpen && <RepositorySettings project={project} sessionToken={sessionToken} onClose={() => setSettingsOpen(false)} onSaved={() => setRevision(value => value + 1)} />}
    </section>
  );
}
