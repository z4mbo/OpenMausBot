import { useState } from "react";
import { Plus, RefreshCw, Rocket } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { handOff } from "@/lib/origin-handoff";
import { originShip, useShipStatus } from "@/lib/origin-ship";
import { useShowThreads } from "@/lib/thread-preferences";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import type { ShipOverview, ShipTarget } from "../../../shared/origin-ship";
import { requestIntegrationFocus } from "../IntegrationKeysSettings";
import { CloudGate, EmptyState, Loading, Notice, PageHeader, ghostButton, pageClass, primaryButton, type OriginPageProps } from "../origin-pages/ui";
import { ReleasePanel, NoRepository } from "./ReleasePanel";
import { TargetCard } from "./TargetCard";
import { TargetDialog } from "./TargetDialog";
import { shipBrief } from "./ship-model";

export function ShipPage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Ship">{({ project, projectId }) => <Ship projectId={projectId} projectName={project.name} agent={agent} />}</CloudGate>;
}

function Ship({ projectId, projectName, agent }: { projectId: string; projectName: string; agent: Bot }) {
  const overview = useCloudQuery<ShipOverview>("ship:overview", { projectId });
  const revision = overview ? overview.targets.map((target) => `${target._id}:${target.updatedAt}`).join(",") : "";
  const ship = useShipStatus(projectId, revision);
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const [editing, setEditing] = useState<ShipTarget | "new" | null>(null);

  if (!overview) return <section className={pageClass} aria-label="Ship"><PageHeader title="Ship" /><Loading label="Loading Ship" variant="grid" /></section>;
  const { targets, isAdmin, canEdit } = overview;
  const statusOf = (target: ShipTarget) => ship.status?.targets.find((entry) => entry.targetId === target._id);
  const openIntegrations = (target: ShipTarget) => {
    requestIntegrationFocus(target.provider === "github-actions" ? "vercel" : target.provider);
    dispatch({ type: "toggleAppSettings", open: true, section: "integrations" });
  };

  return (
    <section className={pageClass} aria-label="Ship">
      <PageHeader title="Ship">
        {targets.length > 0 && (
          <button type="button" className={ghostButton} disabled={ship.loading} onClick={() => void ship.reload()} aria-label="Refresh deployments">
            <RefreshCw size={14} className={cn(ship.loading && "motion-safe:animate-spin")} />Refresh
          </button>
        )}
        {isAdmin && targets.length > 0 && <button type="button" className={primaryButton} onClick={() => setEditing("new")}><Plus size={14} />Add target</button>}
      </PageHeader>

      <div className="flex min-w-0 flex-col gap-5">
        {overview.repoUrl ? (
          <ReleasePanel projectId={projectId} projectName={projectName} releases={overview.releases} targets={targets} canEdit={canEdit} isAdmin={isAdmin}
            writer={{ botId: agent.id, name: agent.name }} onAskChief={() => handOff(dispatch, agent, shipBrief(projectName, targets), showThreads)}
            onPublished={ship.kick} onOpenBroadcast={() => setChiefSectionOf(agent.id, "broadcast")} />
        ) : <NoRepository onOpenSettings={() => setChiefSectionOf(agent.id, "settings")} />}

        <section className="flex min-w-0 flex-col gap-2" aria-label="Deploy targets">
          <h3 className="px-0.5 text-[13.5px] font-semibold text-ink">Deploy targets</h3>
          {ship.error && <Notice tone="danger">{ship.error}</Notice>}
          {!targets.length ? (
            <EmptyState compact icon={<Rocket size={20} />} title="Nowhere to deploy yet"
              body="Connect a Vercel project, Netlify site, Cloudflare Pages project or a GitHub Actions workflow to see deployments and ship from here."
              action={isAdmin ? <button type="button" className={primaryButton} onClick={() => setEditing("new")}><Plus size={14} />Add target</button> : undefined} />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
              {targets.map((target) => (
                <TargetCard key={target._id} target={target} status={statusOf(target)} loading={ship.loading} isAdmin={isAdmin}
                  onEdit={() => setEditing(target)} onConnect={() => openIntegrations(target)}
                  onAct={async (action, deploymentId) => {
                    const { message } = await originShip.act(projectId, target._id, action, deploymentId);
                    ship.kick();
                    return message;
                  }} />
              ))}
            </div>
          )}
        </section>
      </div>

      {editing && <TargetDialog projectId={projectId} target={editing === "new" ? null : editing} defaultBranch="main" onClose={() => setEditing(null)} />}
    </section>
  );
}
