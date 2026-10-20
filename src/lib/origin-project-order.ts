import { useEffect, useRef, useState } from "react";
import { cloudMutation, cloudQueryOnce, useCloudQuery, useCloudUrl } from "./origin-cloud";
import { useCloudToken } from "./origin-cloud/hooks";
import { captureCloudSession } from "./origin-cloud/client";
import { useWorkspaceAccess } from "./origin-members";
import { movedOrder, setProjectOrder, sortProjects, type ProjectSort } from "./origin-workspaces";

interface Project { _id: string; teamId: string }
interface View { order: string[]; sort: ProjectSort; collapsed: boolean }

export function useOriginProjectOrder<T extends { id: string; name: string; updatedAt: number }>(projects: readonly T[], links: Readonly<Record<string, string>>, view: View, teamId: string | null) {
  const rows = useCloudQuery<Project[]>("projects:listForUser", teamId ? { teamId } : "skip");
  const access = useWorkspaceAccess(teamId);
  const url = useCloudUrl(), token = useCloudToken();
  const scope = JSON.stringify([url, token, teamId]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pending = useRef(new Set<string>());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [fresh, setFresh] = useState<{ scope: string; query: Project[] | undefined; rows: Project[] } | null>(null);
  const canonical = fresh?.scope === scope && fresh.query === rows ? fresh.rows : rows;
  const visible = new Set(canonical?.map(row => row._id) ?? []);
  const editable = Boolean(teamId && canonical && access && access.role !== "viewer");
  const ranks = new Map(canonical?.map((row, index) => [row._id, index]));
  const sharedIds = projects.filter(project => links[project.id]).sort((a, b) => (ranks.get(links[a.id]) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(links[b.id]) ?? Number.MAX_SAFE_INTEGER)).map(project => project.id);
  const ordered = sortProjects(projects, view, sharedIds);
  const saving = busy === scope;
  const disabledFor = (id: string) => saving || view.sort !== "custom" || Boolean(teamId && (!access || access.role === "viewer")) || Boolean(links[id] && (!editable || !visible.has(links[id])));
  const move = async (from: string, to: string) => {
    if (from === to || disabledFor(from) || disabledFor(to) || !ordered.some(project => project.id === from) || !ordered.some(project => project.id === to)) return;
    const shared = Boolean(links[from]);
    if (shared !== Boolean(links[to])) return;
    if (!shared) {
      const local = ordered.filter(project => !links[project.id]).map(project => project.id);
      setProjectOrder(movedOrder(local, from, to, local.indexOf(from) < local.indexOf(to) ? "after" : "before"));
      return;
    }
    if (!teamId || !canonical || pending.current.has(scope)) return;
    const expectedProjectIds = canonical.map(project => project._id);
    const projectIds = movedOrder(expectedProjectIds, links[from], links[to], expectedProjectIds.indexOf(links[from]) < expectedProjectIds.indexOf(links[to]) ? "after" : "before");
    if (projectIds.every((id, index) => id === expectedProjectIds[index])) return;
    const attempt = captureCloudSession();
    const current = () => mounted.current && currentScope.current === scope && attempt.isCurrent();
    pending.current.add(scope); setBusy(scope); setFailure(null);
    try {
      await cloudMutation("projects:reorder", { teamId, projectIds, expectedProjectIds });
      if (current()) {
        const byId = new Map(canonical.map(project => [project._id, project]));
        setFresh({ scope, query: rows, rows: projectIds.map(id => byId.get(id)!) });
      }
    } catch (cause) {
      if (!current()) return;
      const message = (cause instanceof Error ? cause.message : "").replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0]?.trim() || "Could not save project order. Try again.";
      setFailure({ scope, message });
      try { const refreshed = await cloudQueryOnce<Project[]>("projects:listForUser", { teamId }); if (current()) setFresh({ scope, query: rows, rows: refreshed }); } catch {}
    } finally { pending.current.delete(scope); if (current()) setBusy(null); }
  };
  const moveBy = (id: string, direction: -1 | 1) => {
    const peers = ordered.filter(project => Boolean(links[project.id]) === Boolean(links[id]));
    const next = peers[peers.findIndex(project => project.id === id) + direction];
    if (next) void move(id, next.id);
  };
  return { ordered, saving, error: failure?.scope === scope ? failure.message : "", disabledFor, move, moveBy };
}
