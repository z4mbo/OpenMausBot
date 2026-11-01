"use client";
import { errorText, mediaErrorText } from "@/lib/error-text";

import { useMutation, useQuery } from "convex/react";
import { TaskModal } from "./issue-detail";
import { ProjectWorkspace } from "./project-workspace";
import { taskKey } from "../lib/project-issues";
import clsx from "clsx";
import { FolderPlus, Check, ChevronDown, ChevronRight, CircleDot, CircleAlert, ImageUp, Inbox, Loader2, LogOut, Menu, Maximize2, MessageCircle, Mic, MicOff, MonitorUp, MonitorOff, PenTool, PhoneOff, Plus, Search, Settings2, Sparkles, PanelLeftClose, PanelLeftOpen, SquarePen, Video, VideoOff, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { MemberProfileContext, useMemberProfile, useWorkspace, type Workspace } from "./workspace-context";
import { MemberProfile } from "./member-profile";
import { useModalKeyboard } from "./use-modal-keyboard";
import { WorkspaceGitHubSetup } from "./repository-settings";
import { useNotifications } from "./use-notifications";
import { ProjectIcon } from "./project-icon";
import { ProjectSortMenu } from "./project-sort-menu";
import { projectSortOptions, sortProjects, type ProjectSort } from "@/lib/project-sort";
import { useProjectPresence } from "./use-project-presence";
import { Dialog } from "./dialog";
import { MotionLayer } from "./motion-layer";
import { ErrorBoundary } from "./error-boundary";
import { IssueComposer } from "./issue-composer";
import { InboxView } from "./inbox-view";
import { CallDevices } from "./call-devices";
import { CallAudio } from "./call-audio";
import { WorkspaceSettings } from "./workspace-settings";
import { FormStatus, type FormNotice } from "./settings-controls";
import { ChatView } from "./chat-shell";
import { UserAvatar, memberName } from "./user-avatar";
import { ContentSkeleton } from "./content-skeleton";
import { DrawView } from "./draw-view";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";
import { SidebarResizeHandle } from "./sidebar-resize-handle";
import { useSidebarLayout } from "./use-sidebar-layout";
import { focusInitialInput, focusQuietly } from "@/lib/initial-focus";
import { swallowPressClick } from "@/lib/outside-press";
import { hasOpenKeyboardOverlay, isEditingTarget, workspaceShortcut } from "@/lib/keyboard-navigation";
import { rankSearchResults } from "@/lib/search-ranking";
import { localApi as requestLocalApi } from "@/lib/client-api";
import { createCallSignaling } from "@/lib/call-signaling";
import { isScreenTrack, selectCallFocus } from "@/lib/call-layout";


export type AuthUser = {
  _id: Id<"users">;
  name: string;
  username?: string;
  email: string;
  avatarUrl?: string | null;
  createdAt?: number;
  role: "owner" | "user";
  status: "active" | "disabled";
};
type MainView = "project" | "inbox" | "chat" | "voice" | "draw";
type ProjectWithUi = Doc<"projects"> & { memberRole: string; iconUrl?: string | null; openIssueCount?: number };
type RemoteCallStream = { stream: MediaStream; screen?: MediaStream; addedAt: number };
type AvatarUser = { username?: string; name: string; email: string; avatarUrl?: string | null };
type LocalChatMessage = {
  id: string;
  authorUserId: Id<"users">;
  authorName: string;
  authorEmail: string;
  avatarUrl?: string | null;
  body: string;
  createdAt: number;
};
type LocalVoiceParticipant = {
  userId: Id<"users">;
  name: string;
  username?: string;
  email: string;
  avatarUrl?: string | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  joinedAt: number;
  lastSeenAt: number;
};
type LocalVoiceSignal = {
  id: string;
  fromUserId: Id<"users">;
  toUserId: Id<"users">;
  fromJoinedAt?: number;
  toJoinedAt?: number;
  kind: "offer" | "answer" | "candidate";
  payload: string;
  createdAt: number;
};

function orderSidebarProjects(projects: ProjectWithUi[]) {
  return [...projects].sort((a, b) => {
    if (a.order !== undefined || b.order !== undefined) return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    return a.name.localeCompare(b.name);
  });
}
function LoadingState({ label = "Loading" }: { label?: string }) {
  return <ContentSkeleton label={label} kind={label.includes("board") || label.includes("project") ? "board" : "list"} rows={4} />;
}
function EmptyBlock({ icon: Icon, title, body }: { icon: typeof Sparkles; title: string; body: string }) {
  return (
    <div className="empty-block">
      <Icon size={22} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

async function localApi<T>(path: string, sessionToken: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${sessionToken}`);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify({ ...(init.json as object), sessionToken }) : init.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Request failed");
  return payload as T;
}

function useLocalVoiceParticipants(sessionToken: string | null, enabled = true) {
  const workspace = useWorkspace();
  const [participants, setParticipants] = useState<LocalVoiceParticipant[] | undefined>(undefined);
  useEffect(() => {
    if (!sessionToken || !enabled) {
      setParticipants(undefined);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const result = await localApi<{ participants: LocalVoiceParticipant[] }>(`/api/local-voice/participants?teamId=${workspace._id}`, sessionToken);
        if (alive) setParticipants(result.participants);
      } catch {
        if (alive) setParticipants(current => current ?? []);
      }
    };
    void load();
    const interval = window.setInterval(load, 3_000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [enabled, sessionToken, workspace._id]);
  return participants;
}


export function OriginWorkspace({ sessionToken, user, workspaces, onLogout }: { sessionToken: string; user: AuthUser; workspaces: Workspace[]; onLogout: () => void }) {
  const workspace = useWorkspace();
  const [activeProjectId, setActiveProjectId] = useState<Id<"projects"> | null>(null);
  const [mainView, setMainView] = useState<MainView>("project");
  const [visitedTools, setVisitedTools] = useState({ draw: false, voice: false });
  const [sidebarLayout, setSidebarLayout] = useSidebarLayout(user._id);
  const sidebarCollapsed = sidebarLayout.collapsed;
  const setSidebarCollapsed = (collapsed: boolean) => setSidebarLayout(current => ({ ...current, collapsed }));
  const [sidebarHover, setSidebarHover] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projectGroupsOpen, setProjectGroupsOpen] = useState({ inactive: false });
  const [searchOpen, setSearchOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    // The phone drawer takes focus when it opens and gives it back to the menu button when it closes.
    if (mobileOpen) focusQuietly(sidebarRef.current?.querySelector<HTMLElement>('.nav-item[aria-current="page"], .project-button[aria-current="page"], .nav-item'));
    else if (drawerWasOpen.current && navButtonRef.current?.getClientRects().length && !document.querySelector("dialog[open]")) focusQuietly(navButtonRef.current);
    drawerWasOpen.current = mobileOpen;
  }, [mobileOpen]);
  const [dragProject, setDragProject] = useState<Id<"projects"> | null>(null);
  const [projectOrder, setProjectOrder] = useState<Id<"projects">[] | null>(null);
  const [projectSort, setProjectSort] = useState<ProjectSort>("manual");
  const sortKey = `origin.project-sort.${user._id}.${workspace._id}`;
  useEffect(() => {
    try { const saved = localStorage.getItem(sortKey); setProjectSort(projectSortOptions.some(option => option.value === saved) ? saved as ProjectSort : "manual"); } catch { setProjectSort("manual"); }
  }, [sortKey]);
  const changeProjectSort = (value: ProjectSort) => {
    setProjectSort(value);
    try { localStorage.setItem(sortKey, value); } catch { /* Sorting still works with browser storage disabled. */ }
  };
  const [shellNotice, setShellNotice] = useState("");
  const [chatFocus, setChatFocus] = useState<string | undefined>();
  const notifications = useNotifications(sessionToken, workspace._id, user._id);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState<string | null>(null);
  const [linkedTask, setLinkedTask] = useState<{ projectId: Id<"projects">; taskId: Id<"tasks"> } | null>(null);
  const [initialIssue, setInitialIssue] = useState<{ projectId: Id<"projects">; taskId: Id<"tasks"> } | null>(null);
  const reorder = useMutation(api.projects.reorder);
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = workspaceRef.current;
    // Phones would pop the keyboard over the view they just opened.
    if (!root || document.querySelector('dialog[open], [aria-modal="true"]') || matchMedia("(pointer: coarse)").matches) return;
    if (root.querySelector("[data-initial-focus]") && !root.contains(document.activeElement)) focusInitialInput(root);
  }, [mainView]);
  const voiceParticipants = useLocalVoiceParticipants(sessionToken, !!sessionToken && !!user);
  const sidebarProjects: ProjectWithUi[] | undefined = projects ? projectOrder ? [...projects].sort((a, b) => projectOrder.indexOf(a._id) - projectOrder.indexOf(b._id)) : sortProjects(orderSidebarProjects(projects), projectSort) : undefined;
  const collaborators = useProjectPresence(sessionToken, workspace._id, mainView === "project" && projects?.some(project => project._id === activeProjectId) ? activeProjectId : null);
  const projectViewers = [...collaborators.map(member => ({ ...member, self: false })),
    ...(mainView === "project" && activeProjectId ? [{ userId: user._id, projectId: activeProjectId, name: user.name, email: user.email, username: user.username, avatarUrl: user.avatarUrl || null, updatedAt: 0, self: true }] : []),
  ];
  const viewersByProject = new Map<string, typeof projectViewers>();
  for (const viewer of projectViewers) {
    const viewers = viewersByProject.get(viewer.projectId) || [];
    viewers.push(viewer);
    viewersByProject.set(viewer.projectId, viewers);
  }

  useEffect(() => { if (mainView === "draw" || mainView === "voice") setVisitedTools(current => ({ ...current, [mainView]: true })); }, [mainView]);

  useEffect(() => {
    localStorage.setItem("origin.workspace", workspace.slug);
    const params = new URLSearchParams(window.location.search);
    const githubStatus = params.get("github");
    if (githubStatus) setShellNotice(githubStatus === "connected" ? "GitHub connected to this workspace." : githubStatus === "app-ready" ? "GitHub App ready. Open Settings > Integrations to connect your workspace." : "GitHub connection was not completed. Try again from Settings > Integrations.");
    const view = params.get("view");
    if (view && ["chat", "voice", "draw", "inbox"].includes(view)) setMainView(view as MainView);
    const project = params.get("project");
    if (project) setActiveProjectId(project as Id<"projects">);
    const issue = params.get("issue");
    if (project && issue) setInitialIssue({ projectId: project as Id<"projects">, taskId: issue as Id<"tasks"> });
  }, [workspace.slug]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      const action = workspaceShortcut(event, {
        editing: isEditingTarget(event.target) || isEditingTarget(document.activeElement),
        overlayOpen: hasOpenKeyboardOverlay(),
        canCreate: workspace.role !== "viewer",
      });
      if (!action) return;
      event.preventDefault();
      if (action === "search") setSearchOpen(true);
      else setIssueOpen(true);
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [workspace.role]);

  useEffect(() => {
    if (projects === undefined) return;
    if (!projects.length) {
      setActiveProjectId(null);
      return;
    }
    const orderedProjects = orderSidebarProjects(projects);
    if (!activeProjectId || !orderedProjects.some((project) => project._id === activeProjectId)) {
      setActiveProjectId(orderedProjects[0]._id);
    }
  }, [projects, activeProjectId]);

  const openProject = (projectId: Id<"projects">) => {
    setActiveProjectId(projectId);
    setInitialIssue(null);
    setMainView("project");
    setMobileOpen(false);
    window.history.replaceState(null, "", `/${workspace.slug}?project=${projectId}`);
  };
  const openIssue = (projectId: Id<"projects">, taskId: Id<"tasks">) => { setLinkedTask(null); openProject(projectId); setInitialIssue({ projectId, taskId }); };
  const openReference = (projectId: Id<"projects">, taskId?: Id<"tasks">) => { if (taskId) setLinkedTask({ projectId, taskId }); else { setLinkedTask(null); openProject(projectId); } };
  const openView = (view: MainView) => {
    setMainView(view); setMobileOpen(false);
    window.history.replaceState(null, "", `/${workspace.slug}?view=${view}`);
  };
  const moveProject = async (target: Id<"projects">) => {
    if (!dragProject || dragProject === target || !sidebarProjects) return;
    const ids = sidebarProjects.map(p => p._id).filter(id => id !== dragProject);
    ids.splice(ids.indexOf(target), 0, dragProject);
    changeProjectSort("manual"); setProjectOrder(ids); setDragProject(null);
    try { await reorder({ sessionToken, teamId: workspace._id, projectIds: ids }); }
    catch (error) { setShellNotice(errorText(error, "Could not reorder projects")); }
    finally { setProjectOrder(null); }
  };

  return (
    <MemberProfileContext.Provider value={setMemberEmail}><div style={{ "--sidebar-width": `${sidebarLayout.width}px` } as CSSProperties} className={clsx("app-shell", "workspace-app", mobileOpen && "mobile-nav-open", sidebarCollapsed && "sidebar-collapsed", sidebarCollapsed && !sidebarHover && "sidebar-hidden", sidebarCollapsed && sidebarHover && "sidebar-floating")}>
      <MotionLayer />
      <header className="mobile-topbar" inert={mobileOpen || undefined}><button ref={navButtonRef} className="icon-button" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="workspace-sidebar" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><strong className="mobile-project-name">{mainView === "project" ? projects?.find(project => project._id === activeProjectId)?.name : { inbox: "Inbox", chat: "Chat", voice: "Call", draw: "Draw" }[mainView]}</strong>{workspace.role !== "viewer" && mainView !== "project" && <button className="icon-button" aria-label="Create issue" onClick={() => setIssueOpen(true)}><SquarePen size={18} /></button>}</header>
      {mobileOpen && <button className="mobile-nav-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setMobileOpen(false)} />}
      {sidebarCollapsed ? <div className="sidebar-hover-zone" onMouseEnter={() => setSidebarHover(true)} /> : null}
      <aside ref={sidebarRef} id="workspace-sidebar" className="sidebar" aria-label="Workspace" onMouseLeave={() => { if (sidebarCollapsed) setSidebarHover(false); }}>
        <div className="sidebar-topbar">
          <ProfileMenu user={user} sessionToken={sessionToken} onLogout={onLogout} sound={notifications.sound} onToggleSound={notifications.toggleSound} workspaces={workspaces} onCreateWorkspace={() => { setMobileOpen(false); setCreateWorkspaceOpen(true); }} onOpenSettings={() => setMobileOpen(false)} onCollapse={() => { setSidebarCollapsed(!sidebarCollapsed); setSidebarHover(false); }} />
          <button className="icon-button" type="button" onClick={() => setSearchOpen(true)} aria-label="Search" title="Search (F or ⌘K)" aria-keyshortcuts="f Meta+K Control+K /">
            <Search size={17} />
          </button>
          <button className="icon-button sidebar-new-issue" title="Create issue (C)" aria-label="Create issue" aria-keyshortcuts="C" disabled={workspace.role === "viewer"} onClick={() => setIssueOpen(true)}><SquarePen size={17} /></button>
        </div>
        <div className="sidebar-content">
          <span className="nav-glider" aria-hidden="true"><span className="nav-glider-avatar"><UserAvatar user={user} size="small" /></span></span>
          <nav className="sidebar-nav">
          <button
            aria-current={mainView === "inbox" ? "page" : undefined} className={clsx("nav-item", mainView === "inbox" && "active")}
            type="button"
            onClick={() => openView("inbox")}
          >
            <Inbox size={16} />
            <span>Inbox</span>
            {(notifications.summary?.unread || 0) > 0 && <small className="nav-unread" aria-label={`${notifications.summary!.unread}${notifications.summary!.more ? "+" : ""} unread notifications`}>{notifications.summary!.unread}{notifications.summary!.more ? "+" : ""}</small>}
          </button>
          <button aria-current={mainView === "chat" ? "page" : undefined} className={clsx("nav-item", mainView === "chat" && "active")} type="button" onClick={() => openView("chat")}>
            <MessageCircle size={16} />
            <span>Chat</span>
          </button>
          <button aria-current={mainView === "voice" ? "page" : undefined} className={clsx("nav-item", mainView === "voice" && "active")} type="button" onClick={() => openView("voice")}>
            <Video size={16} />
            <span>Call</span>
            {(voiceParticipants?.length || 0) > 0 && <small className="nav-live" aria-label={`${voiceParticipants!.length} in call`}>{voiceParticipants!.length}</small>}
          </button>
          <button aria-current={mainView === "draw" ? "page" : undefined} className={clsx("nav-item", mainView === "draw" && "active")} type="button" onClick={() => openView("draw")}><PenTool size={16} /><span>Draw</span></button>
          </nav>
          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <button className="section-toggle" type="button" aria-expanded={projectsOpen} onClick={() => setProjectsOpen((value) => !value)}>
                {projectsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>Projects</span>
              </button>
              <ProjectSortMenu value={projectSort} onChange={changeProjectSort} />
              <CreateProjectInline sessionToken={sessionToken} onCreated={openProject} iconOnly />
            </div>
            {projects === undefined ? <LoadingState label="Projects" /> : null}
              {projectsOpen && <div className="sidebar-project-list">
                {(["active", "inactive"] as const).map(group => <div className="sidebar-project-group" key={group}>
                {group !== "active" && sidebarProjects?.some(project => project.status !== "active") && <button className="section-toggle project-group-toggle" aria-expanded={projectGroupsOpen[group]} onClick={() => setProjectGroupsOpen(current => ({ ...current, [group]: !current[group] }))}>{projectGroupsOpen[group] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>Inactive</span><small>{sidebarProjects?.filter(project => project.status !== "active").length || 0}</small></button>}
                {(group === "active" ? projectsOpen : projectGroupsOpen[group]) && sidebarProjects?.filter(project => group === "active" ? project.status === "active" : project.status !== "active").map((project) => {
                  const viewers = (viewersByProject.get(project._id) || []).sort((a, b) => Number(b.self) - Number(a.self));
                  return (
                  <button
                    key={project._id}
                    data-project-id={project._id}
                    aria-current={mainView === "project" && activeProjectId === project._id ? "page" : undefined} className={clsx("project-button", dragProject === project._id && "dragging", mainView === "project" && activeProjectId === project._id && "active")}
                    type="button"
                    draggable={workspace.role !== "viewer"}
                    onDragStart={event => { setDragProject(project._id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", project._id); }}
                    onDragOver={event => { if (dragProject) event.preventDefault(); }}
                    onDrop={event => { event.preventDefault(); void moveProject(project._id); }}
                    onDragEnd={() => setDragProject(null)}
                    onKeyDown={event => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key) && workspace.role !== "viewer") { event.preventDefault(); const ids = sidebarProjects.map(p => p._id); const at = ids.indexOf(project._id); const target = at + (event.key === "ArrowUp" ? -1 : 1); if (target >= 0 && target < ids.length) { [ids[at], ids[target]] = [ids[target], ids[at]]; changeProjectSort("manual"); void reorder({ sessionToken, teamId: workspace._id, projectIds: ids }).catch(error => setShellNotice(error.message)); } } }}
                    onClick={() => openProject(project._id)}
                  >
                    <ProjectIcon project={project} />
                    <span className="sidebar-project-name">{project.name}</span>
                    <span className="project-trailing"><span className="project-viewers" title={viewers.length ? `${viewers.map(member => member.self ? "You" : member.name).join(", ")} viewing this project` : undefined}>
                      {viewers.slice(0, 2).map(member => <span key={member.userId} className="project-viewer" data-self-viewer={member.self || undefined} aria-label={member.self ? "You are viewing this project" : `${member.name} is viewing this project`}><UserAvatar user={member} size="small" /></span>)}
                      {viewers.length > 2 && <span className="project-viewer viewer-overflow">+{viewers.length - 2}</span>}
                    </span>{(project.openIssueCount ?? 0) > 0 && <small className="project-issue-count" aria-label={`${project.openIssueCount} open issues`}>{project.openIssueCount}</small>}</span>
                  </button>
                ); })}</div>)}
              </div>}
          </div>
        </div>
      </aside>
      {!sidebarCollapsed && <SidebarResizeHandle width={sidebarLayout.width} onResize={width => setSidebarLayout(current => ({ ...current, width }))} onCollapse={width => { setSidebarLayout({ width, collapsed: true }); setSidebarHover(false); }} />}
      <main ref={workspaceRef} inert={mobileOpen || undefined} className={clsx("workspace", mainView === "draw" && "draw-workspace")}>
        {sidebarCollapsed && <button className="icon-button sidebar-restore" aria-label="Keep sidebar open" title="Keep sidebar open" aria-controls="workspace-sidebar" aria-expanded="false" onClick={() => { setSidebarCollapsed(false); setSidebarHover(false); }}><PanelLeftOpen size={18} /></button>}
        {shellNotice && <div className="notice danger">{shellNotice}<button className="icon-button" aria-label="Dismiss" onClick={() => setShellNotice("")}><X size={14} /></button></div>}
        <ErrorBoundary resetKey={`${mainView}:${activeProjectId}`} fallback={<EmptyBlock icon={CircleAlert} title="This view could not load" body="It may have been deleted or your access changed." />}>
        {mainView === "chat" ? (
          <ChatView sessionToken={sessionToken} user={user} focusMessageId={chatFocus} onOpenReference={openReference} />
        ) : mainView === "draw" || mainView === "voice" ? null
        : mainView === "inbox" ? (
          <InboxView sessionToken={sessionToken} unread={notifications.summary?.unread || 0} onOpenProject={openProject} onOpenChat={messageId => { setChatFocus(messageId); openView("chat"); }} onOpenTask={(projectId, taskId) => setLinkedTask({ projectId, taskId })} />
        ) : activeProjectId ? (
          <ProjectWorkspace key={activeProjectId} projectId={activeProjectId} sessionToken={sessionToken} user={user} viewers={projectViewers.filter(v => v.projectId === activeProjectId)} initialTaskId={initialIssue?.projectId === activeProjectId ? initialIssue.taskId : undefined} onOpenReference={(projectId, taskId) => { if (taskId) openIssue(projectId, taskId); else openProject(projectId); }} />
        ) : (
          <EmptyProjects sessionToken={sessionToken} onCreated={openProject} />
        )}
        </ErrorBoundary>
        {visitedTools.draw && <div className="persistent-tool draw-tool" hidden={mainView !== "draw"}><DrawView sessionToken={sessionToken} user={user} /></div>}
        {visitedTools.voice && <div className="persistent-tool voice-tool" hidden={mainView !== "voice"}><VoiceChatView sessionToken={sessionToken} user={user} /></div>}
      </main>
      {issueOpen && <IssueComposer sessionToken={sessionToken} activeProjectId={mainView === "project" ? activeProjectId : null} projects={sidebarProjects || []} onClose={() => setIssueOpen(false)} onCreated={openProject} />}
      {createWorkspaceOpen && <CreateWorkspaceDialog sessionToken={sessionToken} onClose={() => setCreateWorkspaceOpen(false)} />}
      {memberEmail && <MemberProfile key={memberEmail} email={memberEmail} sessionToken={sessionToken} onClose={() => setMemberEmail(null)} onOpenIssue={(projectId, taskId) => { openProject(projectId); setLinkedTask({ projectId, taskId }); }} />}
      {linkedTask && projects?.find(p => p._id === linkedTask.projectId) && <TaskModal project={projects.find(p => p._id === linkedTask.projectId)!} projectId={linkedTask.projectId} taskId={linkedTask.taskId} sessionToken={sessionToken} canEdit={projects.find(p => p._id === linkedTask.projectId)!.memberRole !== "viewer"} onClose={() => setLinkedTask(null)} onOpenReference={openReference} />}
      {searchOpen ? (
        <SearchDialog
          activeProjectId={activeProjectId}
          projects={sidebarProjects ?? []}
          sessionToken={sessionToken}
          onClose={() => setSearchOpen(false)}
          onOpenProject={openProject}
          onOpenChat={messageId => { setChatFocus(messageId); openView("chat"); }}
          onOpenTask={(projectId, taskId) => { openProject(projectId); setLinkedTask({ projectId, taskId }); }}
        />
      ) : null}
    </div></MemberProfileContext.Provider>
  );
}


function ProfileMenu({
  user,
  sessionToken,
  onLogout,
  sound,
  onToggleSound,
  workspaces,
  onCreateWorkspace,
  onCollapse,
  onOpenSettings,
}: {
  user: AuthUser;
  sessionToken: string;
  onLogout: () => void;
  sound: boolean;
  onToggleSound: () => void;
  workspaces: Workspace[];
  onCreateWorkspace: () => void;
  onCollapse: () => void;
  /** Settings opens over everything, so the phone drawer closes first. */
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<false | "first" | "last">(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const workspace = useWorkspace();
  const items = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') || [])];
  const closeMenu = (refocus = true) => { setMenu(false); if (refocus) focusQuietly(triggerRef.current); };
  useEffect(() => {
    if (!menu) return;
    const list = items();
    focusQuietly(menu === "last" ? list.at(-1) : list[0]);
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) { setMenu(false); swallowPressClick(); } };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const choose = (action: () => void) => { closeMenu(); action(); };
  return (
    <div className="profile-menu-wrap" ref={menuRef}>
      {open ? <WorkspaceSettings sessionToken={sessionToken} sound={sound} onToggleSound={onToggleSound} profile={<ProfileSettings user={user} sessionToken={sessionToken} />} security={<PasswordChanger sessionToken={sessionToken} />} onClose={() => setOpen(false)} onLogout={onLogout} /> : null}
      <button ref={triggerRef} className="profile-chip bottom" type="button" aria-label={`${workspace.name}, account menu`} aria-expanded={Boolean(menu)} aria-haspopup="menu" aria-controls={menu ? "account-menu" : undefined} onClick={() => setMenu(menu ? false : "first")} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMenu(event.key === "ArrowUp" ? "last" : "first"); }
      }}>
        <span className="workspace-initial" aria-hidden="true">{workspace.name.slice(0, 1).toUpperCase()}</span>
        <strong>{workspace.name}</strong>
        <ChevronDown className="profile-chevron" size={13} />
      </button>
      {menu && <div ref={listRef} id="account-menu" className="origin-dropdown account-dropdown" role="menu" aria-label="Account and workspaces" onKeyDown={event => {
        const list = items();
        const index = list.indexOf(document.activeElement as HTMLElement);
        const move = (next: number) => { event.preventDefault(); list[(next + list.length) % list.length]?.focus(); };
        if (event.key === "ArrowDown") move(index + 1);
        else if (event.key === "ArrowUp") move(index < 0 ? -1 : index - 1);
        else if (event.key === "Home") move(0);
        else if (event.key === "End") move(list.length - 1);
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
        else if (event.key === "Tab") setMenu(false);
        else if (event.key.length === 1 && /\S/.test(event.key)) {
          const start = index + 1;
          const match = [...list.slice(start), ...list.slice(0, start)].find(item => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
          if (match) { event.preventDefault(); match.focus(); }
        }
      }}>
        <div className="account-identity"><UserAvatar user={user} size="small" /><span><strong>{memberName(user)}</strong><small>{user.email}</small></span></div>
        <hr />
        <span className="dropdown-caption" id="account-menu-workspaces">Workspaces</span>
        <div role="group" aria-labelledby="account-menu-workspaces">
          {workspaces.map(item => <button role="menuitemradio" aria-checked={item._id === workspace._id} tabIndex={-1} key={item._id} onClick={() => choose(() => { if (item._id !== workspace._id) window.location.assign(`/${item.slug}`); })}><span className="workspace-initial" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span><span>{item.name}</span>{item._id === workspace._id && <Check size={14} className="menu-check" />}</button>)}
        </div>
        <button role="menuitem" tabIndex={-1} onClick={() => choose(onCreateWorkspace)}><Plus size={15} /><span>Create workspace</span></button>
        <hr />
        <button role="menuitem" tabIndex={-1} onClick={() => choose(() => { onOpenSettings(); setOpen(true); })}><Settings2 size={15} /><span>Settings</span></button>
        <button role="menuitem" tabIndex={-1} className="menu-desktop-only" onClick={() => choose(onCollapse)}><PanelLeftClose size={15} /><span>Collapse sidebar</span></button>
        <hr />
        <button role="menuitem" tabIndex={-1} onClick={() => choose(onLogout)}><LogOut size={15} /><span>Sign out</span></button>
      </div>}
    </div>
  );
}

function ProfileSettings({ user, sessionToken }: { user: AuthUser; sessionToken: string }) {
  const updateProfile = useMutation(api.auth.updateProfile);
  const generateAvatarUploadUrl = useMutation(api.auth.generateAvatarUploadUrl);
  const savedUsername = user.username || user.email.split("@")[0] || "";
  const [username, setUsername] = useState(savedUsername);
  const [name, setName] = useState(user.name || "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [notice, setNotice] = useState<FormNotice>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUsername(user.username || user.email.split("@")[0] || "");
    setName(user.name || "");
  }, [user.email, user.name, user.username]);
  useEffect(() => {
    if (!avatarFile) { setPreview(""); return; }
    const url = URL.createObjectURL(avatarFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);
  const dirty = name.trim() !== (user.name || "") || username.trim() !== savedUsername || Boolean(avatarFile);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      let avatarStorageId: Id<"_storage"> | undefined;
      if (avatarFile) {
        const uploadUrl = await generateAvatarUploadUrl({ sessionToken });
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": avatarFile.type || "application/octet-stream" }, body: avatarFile });
        if (!res.ok) throw new Error("Photo upload failed");
        const payload = (await res.json()) as { storageId: Id<"_storage"> };
        avatarStorageId = payload.storageId;
      }
      await updateProfile({ sessionToken, username, name, ...(avatarStorageId ? { avatarStorageId } : {}) });
      setAvatarFile(null);
      setNotice({ tone: "success", text: "Profile updated" });
    } catch (error) {
      setNotice({ tone: "danger", text: errorText(error, "Profile update failed") });
    } finally { setBusy(false); }
  };
  return (
    <form className="settings-form" onSubmit={submit}>
      <div className="settings-avatar-row">
        <UserAvatar user={{ ...user, avatarUrl: preview || user.avatarUrl }} className="settings-avatar" />
        <span className="settings-identity"><strong>{memberName({ ...user, name })}</strong><small>{user.email}</small></span>
        <label className="ghost-button compact file-button">
          <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            if (file && (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024)) { setNotice({ tone: "danger", text: "Choose a PNG, JPEG, WebP or GIF under 5 MB" }); return; }
            setNotice(null); setAvatarFile(file);
          }} />
          <ImageUp size={14} />{user.avatarUrl || preview ? "Change photo" : "Upload photo"}
        </label>
      </div>
      <label>Name<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={100} /></label>
      <label>Username<span className="prefixed-input"><span aria-hidden="true">@</span><input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" spellCheck={false} /></span></label>
      <FormStatus notice={notice} />
      <div className="settings-actions"><button className="primary-button compact" type="submit" disabled={busy || !dirty}>{busy && <Loader2 className="spin" size={14} />}Save</button></div>
    </form>
  );
}

function PasswordChanger({ sessionToken }: { sessionToken: string }) {
  const changePassword = useMutation(api.auth.changePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState<FormNotice>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      await changePassword({ sessionToken, currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setNotice({ tone: "success", text: "Password changed" });
    } catch (error) { setNotice({ tone: "danger", text: errorText(error, "Password change failed") }); }
    finally { setBusy(false); }
  };
  return <form className="settings-form" onSubmit={submit}>
    <h4>Password</h4>
    <label>Current password<input value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} type="password" autoComplete="current-password" required maxLength={128} /></label>
    <label>New password<input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="At least 10 characters" /></label>
    <FormStatus notice={notice} />
    <div className="settings-actions"><button className="primary-button compact" type="submit" disabled={busy || !currentPassword || newPassword.length < 10}>{busy && <Loader2 className="spin" size={14} />}Change password</button></div>
  </form>;
}

function CreateProjectInline({ sessionToken, onCreated, iconOnly = false }: { sessionToken: string; onCreated: (id: Id<"projects">) => void; iconOnly?: boolean }) {
  const workspace = useWorkspace();
  const createProject = useMutation(api.projects.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const github = useQuery(api.integrations.status, open ? { sessionToken, teamId: workspace._id } : "skip");
  const [chosenRepoMode, setRepoMode] = useState<"create" | "existing" | "later" | null>(null);
  // Without a connected GitHub account a "create" request would only sit pending, so default to no repository.
  const repoMode = chosenRepoMode ?? (github?.login && github.autoCreate ? "create" : "later");
  const [repoUrl, setRepoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const id = await createProject({ name, sessionToken, teamId: workspace._id, repoUrl: repoMode === "existing" ? repoUrl : undefined, ...(repoMode === "later" ? { githubRepo: "later" as const } : {}) });
      setName("");
      setRepoUrl("");
      setRepoMode(null);
      setOpen(false);
      onCreated(id);
    } catch (err) {
      setError(errorText(err, "Project creation failed"));
    } finally {
      setBusy(false);
    }
  };
  return <><button className={clsx("ghost-button", iconOnly ? "icon-create" : "full")} type="button" aria-label="Create project" title="Create project" disabled={workspace.role === "viewer"} onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />{iconOnly ? null : "New project"}</button>{open && <Dialog title="New project" onClose={() => setOpen(false)}><form className="dialog-body stack-form" onSubmit={submit}><label>Project name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" autoFocus required maxLength={100} /></label><fieldset className="repo-choice"><legend>Repository</legend><label><input type="radio" name="repository-mode" checked={repoMode === "create"} onChange={() => setRepoMode("create")} />Create a private repository</label><label><input type="radio" name="repository-mode" checked={repoMode === "existing"} onChange={() => setRepoMode("existing")} />Link an existing repository</label><label><input type="radio" name="repository-mode" checked={repoMode === "later"} onChange={() => setRepoMode("later")} />No repository</label></fieldset>{repoMode === "existing" && <label>GitHub repository<input value={repoUrl} onChange={event => setRepoUrl(event.target.value)} placeholder="owner/repository" required /></label>}<WorkspaceGitHubSetup sessionToken={sessionToken} />{error ? <div className="notice danger">{error}</div> : null}<div className="row gap"><button className="primary-button compact" type="submit" disabled={busy}>{busy ? "Creating..." : "Create project"}</button><button className="ghost-button compact" type="button" onClick={() => setOpen(false)}>Cancel</button></div></form></Dialog>}</>;
}


function EmptyProjects({ sessionToken, onCreated }: { sessionToken: string; onCreated: (id: Id<"projects">) => void }) {
  const workspace = useWorkspace();
  const admin = ["owner", "admin"].includes(workspace.role);
  return <section className="empty-projects"><FolderPlus size={22} /><h1>No projects</h1>{admin ? <div className="empty-create"><CreateProjectInline sessionToken={sessionToken} onCreated={onCreated} /></div> : <p>A workspace admin can add you to a project.</p>}</section>;
}

function SearchDialog({
  activeProjectId,
  projects,
  sessionToken,
  onClose,
  onOpenProject,
  onOpenTask,
  onOpenChat,
}: {
  activeProjectId: Id<"projects"> | null;
  projects: ProjectWithUi[];
  sessionToken: string;
  onClose: () => void;
  onOpenProject: (id: Id<"projects">) => void;
  onOpenTask: (projectId: Id<"projects">, taskId: Id<"tasks">) => void;
  onOpenChat: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState<string | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  useModalKeyboard(modalRef, onClose);
  const workspace = useWorkspace();
  const openMember = useMemberProfile();
  const issueResults = useQuery(api.workspaceSearch.issues, { sessionToken, teamId: workspace._id, text: query });
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [chatSearchError, setChatSearchError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setMessages([]); setChatSearchError("");
    if (query.trim().length < 2) return () => controller.abort();
    const timer = setTimeout(() => {
      void requestLocalApi<{ messages: LocalChatMessage[] }>(`/api/local-chat/messages?teamId=${workspace._id}&search=${encodeURIComponent(query)}`, sessionToken, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setMessages(result.messages.slice(-8).reverse()); }).catch(() => { if (!controller.signal.aborted) setChatSearchError("Chat search is unavailable"); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, sessionToken, workspace._id]);
  const members = useQuery(api.workspaces.members, { teamId: workspace._id, sessionToken });
  const value = query.trim().toLowerCase();
  const projectResults = value ? projects.filter((project) => project.name.toLowerCase().includes(value)) : projects.slice(0, 5);
  const memberResults = value ? members?.filter((member) => `${member.name} ${member.username || ""} ${member.email}`.toLowerCase().includes(value)).slice(0, 8) : members?.slice(0, 5);
  const results = rankSearchResults([
    ...projectResults.map(project => ({ id: `project-${project._id}`, label: project.name, kind: "Project", icon: <ProjectIcon project={project} />, open: () => { onOpenProject(project._id); onClose(); } })),
    ...(issueResults || []).slice(0, 10).map(task => ({ id: `issue-${task._id}`, label: task.title, kind: taskKey(task._id), icon: <CircleDot size={16} />, open: () => { onOpenTask(task.projectId, task._id); onClose(); } })),
    ...(memberResults || []).map(member => ({ id: `member-${member._id}`, label: memberName(member), kind: member.username ? `@${member.username}` : "Teammate", icon: <UserAvatar user={member} size="small" />, open: () => { onClose(); openMember(member.email); } })),
    ...messages.map(message => ({ id: `chat-${message.id}`, label: message.body.slice(0, 180), kind: "Chat", icon: <MessageCircle size={16} />, open: () => { onOpenChat(message.id); onClose(); } })),
  ], query);
  const activeResult = results.find(result => result.id === selectedResult) || results[0];
  useEffect(() => { if (activeResult) document.getElementById(activeResult.id)?.scrollIntoView({ block: "nearest" }); }, [activeResult?.id]);
  return (
    <div className="modal-backdrop search-backdrop" onClick={onClose}>
      <section ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Search" className="search-modal" onClick={(event) => event.stopPropagation()}>
        <div className="search-input-row"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedResult(null); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && activeResult) { event.preventDefault(); activeResult.open(); }
          else if (["ArrowDown", "ArrowUp"].includes(event.key) && results.length) { event.preventDefault(); const index = results.findIndex(result => result.id === activeResult?.id); setSelectedResult(results[(index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length].id); }
        }} role="combobox" aria-expanded="true" aria-controls="workspace-search-results" aria-activedescendant={activeResult?.id} placeholder="Search projects, issues, people, chat" aria-label="Search projects, issues, people, chat" maxLength={160} data-initial-focus /><button type="button" aria-label="Close search" onClick={onClose}><X size={16} /></button></div>
        <div className="search-results" id="workspace-search-results" role="listbox" aria-label="Search results">
          {results.map(result => <button id={result.id} type="button" role="option" tabIndex={-1} aria-selected={activeResult?.id === result.id} key={result.id} onClick={result.open} onMouseEnter={() => setSelectedResult(result.id)}>{result.icon}<span className="search-result-label">{result.label}</span><small>{result.kind}</small></button>)}
          {!results.length && <p className="muted">No results</p>}
          {chatSearchError && <p className="muted">{chatSearchError}</p>}
        </div>
      </section>
    </div>
  );
}


function VoiceChatView({ sessionToken, user }: { sessionToken: string; user: AuthUser }) {
  const workspace = useWorkspace();
  const localApi = <T,>(path: string, token: string, init: RequestInit & { json?: unknown } = {}) => requestLocalApi<T>(`${path}?teamId=${workspace._id}`, token, init);
  const participants = useLocalVoiceParticipants(sessionToken);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, RemoteCallStream>>({});
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const [signals, setSignals] = useState<LocalVoiceSignal[]>([]);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [audioDevice, setAudioDevice] = useState("");
  const [videoDevice, setVideoDevice] = useState("");
  const [focusedTile, setFocusedTile] = useState<string | null>(null);
  const previousScreensRef = useRef(new Set<string>());
  const screenRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const signalingRef = useRef(new Map<string, ReturnType<typeof createCallSignaling>>());
  const peerSessionsRef = useRef(new Map<string, number>());
  const ownSessionRef = useRef(0);
  const restartTimersRef = useRef(new Map<string, number>());
  const processedSignalsRef = useRef(new Set<string>());
  const joinedRef = useRef(false);
  const sharingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const wasJoined = joinedRef.current;
      joinedRef.current = false;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      signalingRef.current.forEach(signaling => signaling.dispose());
      signalingRef.current.clear(); peerSessionsRef.current.clear();
      restartTimersRef.current.forEach(timer => window.clearTimeout(timer)); restartTimersRef.current.clear();
      processedSignalsRef.current.clear();
      if (wasJoined) {
        void localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } }).catch(() => {});
      }
    };
  }, [sessionToken]);

  const cleanupPeer = (remoteUserId: string) => {
    const connection = peerConnectionsRef.current.get(remoteUserId);
    peerConnectionsRef.current.delete(remoteUserId);
    signalingRef.current.get(remoteUserId)?.dispose(); signalingRef.current.delete(remoteUserId);
    peerSessionsRef.current.delete(remoteUserId);
    window.clearTimeout(restartTimersRef.current.get(remoteUserId)); restartTimersRef.current.delete(remoteUserId);
    connection?.close();
    setRemoteStreams((current) => {
      if (!current[remoteUserId]) return current;
      const next = { ...current };
      delete next[remoteUserId];
      return next;
    });
  };

  const sendPeerSignal = async (toUserId: Id<"users">, kind: "offer" | "answer" | "candidate", payload: string, fromJoinedAt: number, toJoinedAt?: number) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!joinedRef.current || ownSessionRef.current !== fromJoinedAt || peerSessionsRef.current.get(toUserId) !== toJoinedAt) return;
      try { await localApi("/api/local-voice/signals", sessionToken, { method: "POST", json: { toUserId, kind, payload, fromJoinedAt, toJoinedAt } }); return; }
      catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
    }
  };

  const ensurePeerConnection = (remoteUserId: Id<"users">) => {
    const key = remoteUserId.toString();
    const existing = peerConnectionsRef.current.get(key);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const fromSession = ownSessionRef.current, toSession = peerSessionsRef.current.get(key);
    const send = (kind: "offer" | "answer" | "candidate", payload: string) => sendPeerSignal(remoteUserId, kind, payload, fromSession, toSession);
    const signaling = createCallSignaling(connection, user._id.toString() < key, send);
    signalingRef.current.set(key, signaling);
    const signalError = (error: unknown) => { if (joinedRef.current && peerConnectionsRef.current.get(key) === connection) setNotice(errorText(error, "Could not connect call")); };
    connection.onnegotiationneeded = () => { void signaling.offer().catch(signalError); };
    const stream = localStreamRef.current;
    const audioTrack = stream?.getAudioTracks()[0];
    const videoTrack = stream?.getVideoTracks()[0];
    if (audioTrack && stream) connection.addTrack(audioTrack, stream);
    else connection.addTransceiver("audio", { direction: "sendrecv", streams: stream ? [stream] : [] });
    if (videoTrack && stream) connection.addTrack(videoTrack, stream);
    else connection.addTransceiver("video", { direction: "sendrecv", streams: stream ? [stream] : [] });
    // Reserve a separate video transceiver so screen sharing never replaces the camera.
    connection.addTransceiver(screenRef.current?.getVideoTracks()[0] || "video", { direction: "sendrecv", streams: [screenRef.current || new MediaStream()] });
    connection.onicecandidate = (event) => {
      if (event.candidate) void send("candidate", JSON.stringify(event.candidate.toJSON())).catch(signalError);
    };
    connection.ontrack = (event) => {
      if (peerConnectionsRef.current.get(key) !== connection) return;
      // Simultaneous offers can leave an extra reserved video slot before the incoming screen.
      const screenTrack = isScreenTrack(connection.getTransceivers(), event.track);
      setRemoteStreams(current => {
        const stream = new MediaStream(current[key]?.stream.getTracks().filter(track => track.readyState === "live") || []);
        const screen = new MediaStream(current[key]?.screen?.getTracks().filter(track => track.readyState === "live") || []);
        const target = screenTrack ? screen : stream;
        target.getTracks().filter(track => track.kind === event.track.kind && track !== event.track).forEach(track => target.removeTrack(track));
        if (!target.getTracks().includes(event.track)) target.addTrack(event.track);
        return { ...current, [key]: { stream, screen, addedAt: current[key]?.addedAt ?? Date.now() } };
      });
    };
    let restartAttempts = 0;
    const scheduleRestart = (delay: number) => {
      if (restartTimersRef.current.has(key)) return;
      const timer = window.setTimeout(() => {
        restartTimersRef.current.delete(key);
        if (!joinedRef.current || peerConnectionsRef.current.get(key) !== connection || connection.connectionState === "connected") return;
        if (++restartAttempts > 4) { setNotice("Connection interrupted. Leave and rejoin to reconnect."); return; }
        void localApi<{ iceServers: RTCIceServer[] }>("/api/local-voice/config", sessionToken).then(config => {
          if (peerConnectionsRef.current.get(key) !== connection || !joinedRef.current) return;
          iceServersRef.current = config.iceServers; connection.setConfiguration({ iceServers: config.iceServers });
          return signaling.offer(true);
        }).catch(signalError);
        // Keep checking: a restart whose offer or answer is lost would otherwise stay "connecting".
        scheduleRestart(10_000);
      }, delay);
      restartTimersRef.current.set(key, timer);
    };
    connection.onconnectionstatechange = () => {
      if (peerConnectionsRef.current.get(key) !== connection || !joinedRef.current) return;
      if (connection.connectionState === "connected") {
        restartAttempts = 0; window.clearTimeout(restartTimersRef.current.get(key)); restartTimersRef.current.delete(key); setNotice("");
      } else if (["disconnected", "failed"].includes(connection.connectionState)) {
        if (connection.connectionState === "failed") { window.clearTimeout(restartTimersRef.current.get(key)); restartTimersRef.current.delete(key); }
        scheduleRestart(connection.connectionState === "failed" ? 500 : 4000);
      } else if (connection.connectionState === "closed") cleanupPeer(key);
    };
    // A lost offer or answer leaves the peer "new" or "connecting" with no state change to react to.
    scheduleRestart(10_000);
    peerConnectionsRef.current.set(key, connection);
    return connection;
  };

  const startCall = async () => {
    if (joining || localStreamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("Camera and microphone are not available in this browser.");
      return;
    }
    let stream: MediaStream | null = null;
    let mediaIssue = "";
    setJoining(true);
    setDevicesOpen(false);
    try {
      const configuration = await localApi<{ iceServers: RTCIceServer[] }>("/api/local-voice/config", sessionToken);
      iceServersRef.current = configuration.iceServers;
      try {
        stream = audioEnabled || videoEnabled ? await navigator.mediaDevices.getUserMedia({ audio: audioEnabled ? { ...(audioDevice ? { deviceId: { exact: audioDevice } } : {}), echoCancellation: true, noiseSuppression: true } : false, video: videoEnabled ? { ...(videoDevice ? { deviceId: { exact: videoDevice } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } : false }) : new MediaStream();
      } catch (error) {
        // Fall back to audio only, then to listening only, so a missing or blocked device never blocks joining.
        try { stream = audioEnabled ? await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true, video: false }) : new MediaStream(); }
        catch (audioError) { stream = new MediaStream(); mediaIssue = mediaErrorText(audioError); }
        if (!mediaIssue && videoEnabled) mediaIssue = mediaErrorText(error, "camera");
      }
      const hasAudio = stream.getAudioTracks().length > 0;
      const hasVideo = stream.getVideoTracks().length > 0;
      if (!mountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const presence = await localApi<{ joinedAt: number }>("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "join", audioEnabled: hasAudio, videoEnabled: hasVideo },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        await localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } });
        return;
      }
      joinedRef.current = true;
      ownSessionRef.current = presence.joinedAt;
      localStreamRef.current = stream;
      setLocalStream(stream);
      setDevicesOpen(false);
      setJoinedAt(Date.now());
      setAudioEnabled(hasAudio);
      setVideoEnabled(hasVideo);
      setNotice(mediaIssue);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mountedRef.current) setNotice(errorText(error, "Could not start call"));
    } finally { if (mountedRef.current) setJoining(false); }
  };
  const leaveCall = async () => {
    joinedRef.current = false;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null; localStreamRef.current = null;
    setScreenStream(null); setJoinedAt(null); setFocusedTile(null);
    setLocalStream(null);
    setRemoteStreams({});
    peerConnectionsRef.current.forEach((connection) => connection.close());
    peerConnectionsRef.current.clear();
    signalingRef.current.forEach(signaling => signaling.dispose()); signalingRef.current.clear(); peerSessionsRef.current.clear();
    restartTimersRef.current.forEach(timer => window.clearTimeout(timer)); restartTimersRef.current.clear();
    processedSignalsRef.current.clear();
    await localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } }).catch(() => {});
  };
  const stopSharing = async () => {
    screenRef.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    screenRef.current = null; setScreenStream(null); setFocusedTile(current => current === "self:screen" ? null : current);
    await Promise.allSettled([...peerConnectionsRef.current.values()].map(connection => connection.getTransceivers().filter(t => t.receiver.track.kind === "video")[1]?.sender.replaceTrack(null)));
  };
  const shareScreen = async () => {
    if (sharingRef.current || !joinedRef.current) return;
    if (screenRef.current) { await stopSharing(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { setNotice("Screen sharing is not supported in this browser. You can still view a teammate's screen."); return; }
    let screen: MediaStream | null = null;
    sharingRef.current = true;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      if (!joinedRef.current) { screen.getTracks().forEach(track => track.stop()); return; }
      const track = screen.getVideoTracks()[0];
      screenRef.current = screen;
      await Promise.all([...peerConnectionsRef.current.values()].map(connection => connection.getTransceivers().filter(t => t.receiver.track.kind === "video")[1]?.sender.replaceTrack(track)));
      track.onended = () => { void stopSharing(); };
      if (!joinedRef.current || track.readyState === "ended") { await stopSharing(); return; }
      setScreenStream(screen); setNotice("");
    } catch (error) {
      screen?.getTracks().forEach(track => track.stop());
      await stopSharing();
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) setNotice(errorText(error, "Could not share screen"));
    } finally { sharingRef.current = false; }
  };
  useEffect(() => { if (!joinedAt) return; const tick = () => setElapsed(Math.floor((Date.now() - joinedAt) / 1000)); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [joinedAt]);
  const toggleAudio = async () => {
    const next = !audioEnabled;
    if (next && localStream && !localStream.getAudioTracks().some(t => t.readyState === "live")) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true });
        if (!joinedRef.current || localStreamRef.current !== localStream) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getAudioTracks()[0];
        localStream.addTrack(track);
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === "audio")?.sender.replaceTrack(track)));
      } catch { setNotice("Microphone access was denied. Check your browser permissions."); return; }
    }
    localStream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setAudioEnabled(next);
    if (localStream) {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled: next, videoEnabled, screenSharing: !!screenRef.current },
      }).catch(() => {});
    }
  };
  const toggleVideo = async () => {
    const next = !videoEnabled;
    if (next && localStream && !localStream.getVideoTracks().some(t => t.readyState === "live")) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoDevice ? { deviceId: { exact: videoDevice } } : true });
        if (!joinedRef.current || localStreamRef.current !== localStream) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getVideoTracks()[0];
        localStream.addTrack(track);
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === "video")?.sender.replaceTrack(track)));
      } catch { setNotice("Camera access was denied. Check your browser permissions."); return; }
    }
    localStream?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setVideoEnabled(next);
    if (localStream) {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled, videoEnabled: next, screenSharing: !!screenRef.current },
      }).catch(() => {});
    }
  };

  useEffect(() => {
    if (!localStream) return;
    const heartbeat = () => {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled, videoEnabled, screenSharing: !!screenStream },
      }).catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 8_000);
    return () => window.clearInterval(interval);
  }, [audioEnabled, localStream, sessionToken, videoEnabled, screenStream]);

  useEffect(() => {
    if (!localStream) {
      setSignals([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const result = await localApi<{ signals: LocalVoiceSignal[] }>("/api/local-voice/signals", sessionToken);
        if (alive) setSignals(result.signals);
      } catch (error) {
        if (alive) setNotice(errorText(error, "Could not load call signals"));
      }
    };
    void load();
    const interval = window.setInterval(load, 1_200);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [localStream, sessionToken]);

  useEffect(() => {
    if (!localStream || !participants) return;
    const remoteParticipants = participants.filter((participant) => participant.userId !== user._id);
    const activeRemoteIds = new Set(remoteParticipants.map((participant) => participant.userId.toString()));
    peerConnectionsRef.current.forEach((_, remoteUserId) => {
      if (!activeRemoteIds.has(remoteUserId)) cleanupPeer(remoteUserId);
    });
    for (const participant of remoteParticipants) {
      const previousSession = peerSessionsRef.current.get(participant.userId);
      if (previousSession !== undefined && previousSession > participant.joinedAt) continue;
      if (previousSession !== undefined && previousSession !== participant.joinedAt) cleanupPeer(participant.userId);
      peerSessionsRef.current.set(participant.userId, participant.joinedAt);
      ensurePeerConnection(participant.userId);
    }
  }, [localStream, participants, user._id]);

  useEffect(() => {
    if (!localStream || !signals?.length) return;
    const handleSignals = async () => {
      const ackIds: string[] = [];
      for (const signal of signals) {
        if (!joinedRef.current) break;
        const key = signal.id;
        if (processedSignalsRef.current.has(key)) continue;
        processedSignalsRef.current.add(key);
        ackIds.push(signal.id);
        if (signal.toJoinedAt !== undefined && signal.toJoinedAt !== ownSessionRef.current) continue;
        const previousSession = peerSessionsRef.current.get(signal.fromUserId);
        if (signal.fromJoinedAt !== undefined) {
          if (previousSession !== undefined && previousSession > signal.fromJoinedAt) continue;
          if (previousSession !== undefined && previousSession !== signal.fromJoinedAt) cleanupPeer(signal.fromUserId);
          peerSessionsRef.current.set(signal.fromUserId, signal.fromJoinedAt);
        }
        ensurePeerConnection(signal.fromUserId);
        try {
          await signalingRef.current.get(signal.fromUserId)?.receive(signal.kind, signal.payload);
        } catch (error) {
          setNotice(errorText(error, "Call connection failed"));
        }
      }
      if (ackIds.length) {
        await localApi("/api/local-voice/signals", sessionToken, { method: "DELETE", json: { signalIds: ackIds } }).catch(() => {});
      }
    };
    void handleSignals();
  }, [localStream, sessionToken, signals]);

  const activeParticipants = participants ?? [];
  const remoteParticipants = activeParticipants.filter((participant) => participant.userId !== user._id);
  const callTiles: { id: string; stream?: MediaStream; participant: AvatarUser; label: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean }[] = localStream ? [
    ...(screenStream ? [{ id: "self:screen", stream: screenStream, participant: user, label: "Your screen", audioEnabled: false, videoEnabled: true, screenSharing: true }] : []),
    { id: "self:camera", stream: localStream, participant: user, label: "You", audioEnabled, videoEnabled },
    ...remoteParticipants.flatMap(participant => {
      const remote = remoteStreams[participant.userId];
      return [
        ...(participant.screenSharing && remote?.screen ? [{ id: `${participant.userId}:screen`, stream: remote.screen, participant, label: `${memberName(participant)}'s screen`, audioEnabled: false, videoEnabled: true, screenSharing: true }] : []),
        { id: `${participant.userId}:camera`, stream: remote?.stream, participant, label: memberName(participant), audioEnabled: participant.audioEnabled, videoEnabled: participant.videoEnabled },
      ];
    }),
  ] : [];
  const selectedTileId = selectCallFocus(callTiles, focusedTile, previousScreensRef.current);
  const mainTile = callTiles.find(tile => tile.id === selectedTileId);
  const screenTileIds = callTiles.filter(tile => tile.screenSharing).map(tile => tile.id).join(",");
  useEffect(() => {
    setFocusedTile(selectedTileId);
    previousScreensRef.current = new Set(screenTileIds ? screenTileIds.split(",") : []);
  }, [selectedTileId, screenTileIds]);
  const changeDevice = async (kind: "audio" | "video", deviceId: string) => {
    const stream = localStreamRef.current;
    if (stream && (kind === "audio" ? audioEnabled : videoEnabled)) {
      const capture = await navigator.mediaDevices.getUserMedia({ [kind]: deviceId ? { deviceId: { exact: deviceId } } : true });
      if (!joinedRef.current || localStreamRef.current !== stream) { capture.getTracks().forEach(track => track.stop()); return; }
      const track = capture.getTracks()[0];
      try {
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === kind)?.sender.replaceTrack(track)));
        stream.getTracks().filter(t => t.kind === kind).forEach(t => { stream.removeTrack(t); t.stop(); });
        stream.addTrack(track); const next = new MediaStream(stream.getTracks()); localStreamRef.current = next; setLocalStream(next);
      } catch (error) { capture.getTracks().forEach(t => t.stop()); throw error; }
    } else if (stream) {
      // A device selected while muted is acquired only after explicitly unmuting.
      stream.getTracks().filter(t => t.kind === kind).forEach(t => { stream.removeTrack(t); t.stop(); });
    }
    if (kind === "audio") setAudioDevice(deviceId); else setVideoDevice(deviceId);
  };
  return (
    <section className="voice-workspace">
      <div className={clsx("call-utility-bar", !localStream && !activeParticipants.length && "idle")}><h1 className="call-title">Call</h1><div className="call-participant-strip" aria-label="Call participants">{participants === undefined ? <ContentSkeleton label="Loading participants" rows={1} /> : activeParticipants.map(participant => <button key={participant.userId} className="call-participant-chip" onClick={() => setFocusedTile(participant.userId === user._id ? "self:camera" : `${participant.userId}:camera`)}><UserAvatar user={participant.userId === user._id ? user : participant} size="small" /><span>{participant.userId === user._id ? "You" : memberName(participant)}</span></button>)}</div><div className="call-header-actions">{localStream && <time className="call-elapsed" aria-label="Call duration">{Math.floor(elapsed / 60).toString().padStart(2, "0")}:{(elapsed % 60).toString().padStart(2, "0")}</time>}<button className="icon-button" title="Call devices" aria-label="Call devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)}><Settings2 size={16} /></button></div></div>
      {devicesOpen && <CallDevices audioId={audioDevice} videoId={videoDevice} inCall={!!localStream} onChange={changeDevice} onClose={() => setDevicesOpen(false)} />}
      <div className="call-dock" hidden={!localStream}>
        <div className="call-filmstrip" aria-label="Other cameras and shared screens">
          {callTiles.filter(tile => tile.id !== selectedTileId).map(tile => <CallVideoTile key={tile.id} {...tile} thumbnail onFocus={() => setFocusedTile(tile.id)} />)}
        </div>
        {localStream && <div className="call-controls">
          <button type="button" aria-label={audioEnabled ? "Mute microphone" : "Unmute microphone"} title={audioEnabled ? "Mute microphone" : "Unmute microphone"} onClick={toggleAudio}>{audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}</button>
          <button type="button" aria-label={videoEnabled ? "Turn camera off" : "Turn camera on"} title={videoEnabled ? "Turn camera off" : "Turn camera on"} onClick={toggleVideo}>{videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}</button>
          <button type="button" className={screenStream ? "sharing" : ""} aria-label={screenStream ? "Stop sharing" : "Share screen"} title={screenStream ? "Stop sharing" : "Share screen"} onClick={shareScreen}>{screenStream ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</button>
          <button type="button" className="leave-call" aria-label="Leave call" title="Leave call" onClick={leaveCall}><PhoneOff size={18} /></button>
        </div>}
      </div>
      <div className="voice-workspace-grid">
        <div className={clsx("voice-room stage", localStream && "in-call call-main-stage")}>
          {mainTile ? (
            <CallVideoTile key={mainTile.id} {...mainTile} />
          ) : (
            <div className="call-lobby"><div className="lobby-avatar"><UserAvatar user={user} /></div>{remoteParticipants.length > 0 && <h2>{remoteParticipants.map(participant => memberName(participant).split(" ")[0]).slice(0, 3).join(", ")}{remoteParticipants.length > 3 ? ` +${remoteParticipants.length - 3}` : ""} in call</h2>}<div className="lobby-devices"><button title={audioEnabled ? "Microphone on" : "Microphone off"} aria-label="Microphone" aria-pressed={audioEnabled} onClick={() => setAudioEnabled(!audioEnabled)}>{audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}</button><button title={videoEnabled ? "Camera on" : "Camera off"} aria-label="Camera" aria-pressed={videoEnabled} onClick={() => setVideoEnabled(!videoEnabled)}>{videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}</button><button className="lobby-settings" aria-label="Call devices" title="Call devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)}><Settings2 size={18} /></button><button className="primary-button lobby-join" onClick={startCall} disabled={joining || workspace.role === "viewer"}>{joining ? <Loader2 className="spin" size={16} /> : <Video size={16} />}Join call</button></div></div>
          )}
        </div>
      </div>
      <div className="call-audio-output">{localStream && remoteParticipants.map(participant => remoteStreams[participant.userId] && <CallAudio key={participant.userId} stream={remoteStreams[participant.userId].stream} name={participant.name} />)}</div>
      {notice ? <small className="call-notice">{notice}</small> : null}
    </section>
  );
}

function CallVideoTile({
  stream,
  participant,
  label,
  audioEnabled,
  videoEnabled,
  screenSharing = false,
  thumbnail = false,
  onFocus,
}: {
  stream?: MediaStream;
  participant: AvatarUser;
  label?: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  thumbnail?: boolean;
  onFocus?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const openMember = useMemberProfile();
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);
  return (
    <div ref={tileRef} className={clsx("call-tile", (!videoEnabled || !stream) && "video-off", screenSharing && "screen-share-tile", thumbnail && "call-thumbnail")}>
      {thumbnail && <button type="button" className="call-tile-focus" title={`Enlarge ${label || participant.name}`} aria-label={`Enlarge ${label || participant.name}`} onClick={onFocus} />}
      <video ref={videoRef} autoPlay muted playsInline style={!videoEnabled || !stream ? { position: "absolute", width: 1, height: 1, opacity: 0 } : undefined} />{(!videoEnabled || !stream) && <div className="video-avatar"><UserAvatar user={participant} />{!stream && <small>Connecting</small>}</div>}
      <div className="call-tile-meta">
        {thumbnail ? <span className="call-thumbnail-name">{label ?? memberName(participant)}</span> : <button className="call-member-profile" onClick={() => openMember(participant.email)} aria-label={`View ${participant.name} profile`}>{label ?? memberName(participant)}</button>}
        {screenSharing ? <MonitorUp size={13} /> : audioEnabled ? <Mic size={13} /> : <MicOff size={13} />}
        {!thumbnail && videoEnabled && stream && <button className="icon-button call-fullscreen" title="Full screen" aria-label={`Full screen ${label || participant.name}`} onClick={() => { if (!tileRef.current?.requestFullscreen) { setFullscreenError("Full screen is unavailable in this browser"); return; } void tileRef.current.requestFullscreen().catch(() => setFullscreenError("Could not enter full screen")); }}><Maximize2 size={14} /></button>}
      </div>
      {fullscreenError && <small className="call-tile-error" role="status">{fullscreenError}</small>}
    </div>
  );
}
