import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, Loader2, X } from "lucide-react";
import { cloud, useCloudSession, type CloudProject, type CloudWorkspace } from "@/lib/origin-cloud";
import { refreshCloudLinks, useCloudLinks } from "@/lib/origin-cloud-links";
import { invertLinks, planImport, planIsEmpty, runImport, type ImportPlan, type ImportResult } from "@/lib/origin-import";
import { PROJECT_LEAD_ROLE } from "@/lib/origin-teams";
import { api, useStore, type Bot } from "@/state/store";
import { OriginConnectDialog } from "./OriginConnect";

type CloudTree = { workspaces: CloudWorkspace[]; projects: CloudProject[] };
type Phase = "choose" | "preview" | "running" | "done";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

async function loadCloudTree(): Promise<CloudTree> {
  const workspaces = await cloud.workspaces.list();
  const projects = (await Promise.all(workspaces.map((workspace) => cloud.projects.listForUser(workspace._id)))).flat();
  return { workspaces, projects };
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

/** Brings Origin cloud workspaces and projects into this app as local workspaces and project teams. Reads the cloud only. */
export function OriginImportDialog({ onClose }: { onClose(): void }) {
  const session = useCloudSession();
  const { state, dispatch } = useStore();
  const links = useCloudLinks();
  const [tree, setTree] = useState<CloudTree | null>(null);
  const [loadError, setLoadError] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [chosenWorkspaces, setChosenWorkspaces] = useState<string[]>([]);
  const [chosenProjects, setChosenProjects] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("choose");
  const [result, setResult] = useState<ImportResult | null>(null);
  const signedIn = Boolean(session.user);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setLoadError("");
    void refreshCloudLinks();
    loadCloudTree().then((loaded) => { if (alive) setTree(loaded); }, (cause) => { if (alive) setLoadError(message(cause)); });
    return () => { alive = false; };
  }, [signedIn]);

  const botById = useMemo(() => new Map(state.bots.map((bot) => [bot.id, bot])), [state.bots]);
  const linkedHead = useMemo(() => invertLinks(links.workspaces), [links.workspaces]);
  const linkedChief = useMemo(() => invertLinks(links.projects), [links.projects]);
  const localName = (botId: string | undefined) => (botId ? botById.get(botId)?.name : undefined);

  const plan: ImportPlan | null = useMemo(() => tree && planImport(tree, { bots: state.bots, links }, {
    workspaces: chosenWorkspaces, projects: chosenProjects,
  }), [tree, state.bots, links, chosenWorkspaces, chosenProjects]);

  const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
    const answer = await api<T & { bot?: Bot; chief?: Bot; members?: Bot[] }>(path, init);
    for (const bot of [answer.bot, answer.chief, ...(answer.members ?? [])]) if (bot) dispatch({ type: "botAdded", bot, preserveSelection: true });
    return answer;
  };

  const start = async () => {
    if (!plan) return;
    setPhase("running");
    try {
      setResult(await runImport(plan, { call, lead: PROJECT_LEAD_ROLE }));
    } catch (cause) {
      setResult({ createdWorkspaces: [], createdProjects: [], failures: [{ name: "Import", error: message(cause) }] });
    }
    await refreshCloudLinks();
    setPhase("done");
  };

  const box = "size-4 shrink-0 accent-[var(--color-accent,#6366f1)]";
  const linkedBadge = (name: string | undefined) => name
    ? <span className="ml-auto flex items-center gap-1 text-[11.5px] text-ink-secondary"><Link2 size={12} />{name}</span>
    : null;

  const body = () => {
    if (!session.ready) return <p className="text-[13px] text-ink-secondary">Checking your Origin account…</p>;
    if (!signedIn) {
      return (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-secondary">Sign in to your Origin account to see its workspaces and projects.</p>
          <button type="button" onClick={() => setConnectOpen(true)} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white">Sign in</button>
        </div>
      );
    }
    if (loadError) return <p role="alert" className="text-[12.5px] text-danger">{loadError}</p>;
    if (!tree || !plan) return <p className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />Loading your Origin workspaces…</p>;
    if (phase === "done" && result) return <Summary result={result} />;
    if (phase === "preview" || phase === "running") return <Preview plan={plan} />;
    if (!tree.workspaces.length) return <p className="text-[13px] text-ink-secondary">This Origin account has no workspaces yet.</p>;
    return (
      <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
        {tree.workspaces.map((workspace) => {
          const projects = tree.projects.filter((project) => project.teamId === workspace._id);
          return (
            <div key={workspace._id}>
              <label className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                <input type="checkbox" className={box} checked={chosenWorkspaces.includes(workspace._id)}
                  onChange={() => setChosenWorkspaces((list) => toggled(list, workspace._id))} />
                {workspace.name}
                {linkedBadge(localName(linkedHead.get(workspace._id)))}
              </label>
              <div className="mt-1.5 space-y-1 pl-6">
                {projects.length ? projects.map((project) => {
                  const chief = localName(linkedChief.get(project._id));
                  return (
                    <label key={project._id} className="flex items-center gap-2 text-[13px] text-ink">
                      <input type="checkbox" className={box} disabled={Boolean(chief)} checked={Boolean(chief) || chosenProjects.includes(project._id)}
                        onChange={() => setChosenProjects((list) => toggled(list, project._id))} />
                      {project.name}
                      {linkedBadge(chief)}
                    </label>
                  );
                }) : <p className="text-[12px] text-ink-secondary">No projects</p>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const footer = () => {
    if (!signedIn || !plan) return null;
    if (phase === "choose") {
      return <button type="button" disabled={planIsEmpty(plan)} onClick={() => setPhase("preview")}
        className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">Review import</button>;
    }
    if (phase === "preview" || phase === "running") {
      return (
        <>
          <button type="button" disabled={phase === "running"} onClick={() => setPhase("choose")}
            className="rounded-lg bg-raised px-4 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40">Back</button>
          <button type="button" disabled={phase === "running"} onClick={() => void start()}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">
            {phase === "running" && <Loader2 size={14} className="animate-spin" />}Import
          </button>
        </>
      );
    }
    return <button type="button" onClick={onClose} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white">Done</button>;
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget && phase !== "running") onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Import from Origin" className="w-full max-w-[480px] rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">Import from Origin</h2>
          <button type="button" aria-label="Close" disabled={phase === "running"} onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"><X size={16} /></button>
        </div>
        {body()}
        <div className="mt-5 flex justify-end gap-2">{footer()}</div>
      </div>
      {connectOpen && <OriginConnectDialog onClose={() => setConnectOpen(false)} />}
    </div>,
    document.body,
  );
}

function Preview({ plan }: { plan: ImportPlan }) {
  const newHeads = plan.workspaces.filter((step) => !step.headId);
  const workspaceName = (teamId: string) => {
    const step = plan.workspaces.find((candidate) => candidate.cloudTeamId === teamId);
    return step?.headName ?? step?.name ?? "";
  };
  return (
    <div className="space-y-3 text-[13px] text-ink">
      <p className="font-medium">Will create:</p>
      <ul className="list-disc space-y-1 pl-5">
        {newHeads.map((step) => <li key={step.cloudTeamId}>Workspace <b>{step.name}</b>, linked to the Origin workspace</li>)}
        {plan.projects.map((step) => (
          <li key={step.cloudProjectId}>Project <b>{step.name}</b> with its 6 default agents, in workspace {workspaceName(step.cloudTeamId)}</li>
        ))}
        {!newHeads.length && !plan.projects.length && <li className="text-ink-secondary">Nothing new</li>}
      </ul>
      {plan.alreadyLinked.length > 0 && (
        <p className="text-[12.5px] text-ink-secondary">Already linked, left as they are: {plan.alreadyLinked.map((item) => item.name).join(", ")}</p>
      )}
      <p className="text-[12.5px] text-ink-secondary">Nothing is changed in Origin.</p>
    </div>
  );
}

function Summary({ result }: { result: ImportResult }) {
  return (
    <div className="space-y-2 text-[13px] text-ink">
      {result.createdWorkspaces.map((item) => <p key={item.botId} className="flex items-center gap-2"><Check size={14} className="text-success" />Workspace {item.name} created and linked</p>)}
      {result.createdProjects.map((item) => (
        <p key={item.botId} className="flex items-center gap-2"><Check size={14} className="text-success" />Project {item.name} created with {item.agents} agents in {item.workspace}</p>
      ))}
      {result.failures.map((item) => <p key={item.name} role="alert" className="text-danger">{item.name}: {item.error}</p>)}
      {!result.createdWorkspaces.length && !result.createdProjects.length && !result.failures.length && <p className="text-ink-secondary">Nothing to import.</p>}
    </div>
  );
}
