import { useEffect, useRef, useState } from "react";
import { cloudMutation, useCloudQuery } from "./origin-cloud";
export { inArchivedProject, setArchivedSections, useArchivedSections } from "./origin-archived";

export type ProjectStatus = "active" | "inactive";

export interface CloudProjectRow {
  _id: string;
  teamId: string;
  name: string;
  status: ProjectStatus;
  memberRole?: string;
  openIssueCount?: number;
}

export interface ProjectViewer {
  userId: string;
  projectId: string;
  name: string;
  email: string;
  username?: string;
  avatarUrl: string | null;
  updatedAt: number;
  self?: boolean;
}

interface Section { id: string; section?: string; chiefOfStaff?: boolean }

/** The section of every project Chief whose linked Origin project is inactive. */
export function archivedSectionsOf(chiefs: readonly Section[], links: Record<string, string>, status: ReadonlyMap<string, ProjectStatus>): Set<string> {
  const sections = new Set<string>();
  for (const chief of chiefs) {
    const cloudId = links[chief.id];
    const section = chief.section?.trim();
    if (chief.chiefOfStaff && cloudId && section && status.get(cloudId) === "inactive") sections.add(section);
  }
  return sections;
}

/** Live projects of one Origin workspace, plus the status of every project the account can see. */
export function useOriginProjects(teamId: string | null | undefined): { rows: CloudProjectRow[] | undefined; status: ReadonlyMap<string, ProjectStatus> } {
  const team = useCloudQuery<CloudProjectRow[]>("projects:listForUser", teamId ? { teamId } : "skip");
  const all = useCloudQuery<CloudProjectRow[]>("projects:listForUser", {});
  const known = useRef(new Map<string, ProjectStatus>());
  for (const row of [...(all ?? []), ...(team ?? [])]) known.current.set(row._id, row.status);
  return { rows: team, status: known.current };
}

export function setProjectStatus(projectId: string, status: ProjectStatus): Promise<unknown> {
  return cloudMutation("projects:update", { projectId, status });
}

export const canManageProject = (row: CloudProjectRow | undefined) => row?.memberRole === "owner" || row?.memberRole === "admin";

const PRESENCE_WINDOW_MS = 60_000;
const HEARTBEAT_MS = 20_000;

function newClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Tells teammates which project this person has open and lists where they are. Presence rows expire on the server after a minute. */
export function useProjectPresence(teamId: string | null | undefined, projectId: string | null): ProjectViewer[] {
  const [now, setNow] = useState(() => Date.now());
  const since = Math.floor(now / 15_000) * 15_000 - PRESENCE_WINDOW_MS;
  const rows = useCloudQuery<ProjectViewer[]>("projectPresence:list", teamId ? { teamId, activeSince: since } : "skip");
  const client = useRef({ id: "", sequence: 0 });

  useEffect(() => {
    if (!teamId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    client.current.id ||= newClientId();
    const clientId = client.current.id;
    const publish = (leave = false) => {
      const here = !leave && document.visibilityState === "visible" ? projectId : null;
      cloudMutation("projectPresence:update", { teamId, clientId, sequence: ++client.current.sequence, projectId: here })
        .catch(() => undefined);
    };
    const visibility = () => publish();
    const leave = () => publish(true);
    publish();
    const heartbeat = window.setInterval(() => { if (document.visibilityState === "visible" && projectId) publish(); }, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [teamId, projectId]);

  const last = useRef<{ teamId: string | null | undefined; rows: ProjectViewer[] }>({ teamId, rows: [] });
  if (last.current.teamId !== teamId) last.current = { teamId, rows: [] };
  if (rows) last.current.rows = rows;
  return last.current.rows.filter((row) => row.updatedAt > now - PRESENCE_WINDOW_MS);
}

export function viewersByProject(others: readonly ProjectViewer[], self: ProjectViewer | null): Map<string, ProjectViewer[]> {
  const map = new Map<string, ProjectViewer[]>();
  for (const viewer of self ? [self, ...others] : others) {
    const list = map.get(viewer.projectId) ?? [];
    if (list.some((shown) => shown.userId === viewer.userId)) continue;
    list.push(viewer);
    map.set(viewer.projectId, list);
  }
  return map;
}
