import { useState } from "react";
import { Check, Cloud, Copy, Diamond, ExternalLink, KeyRound, Loader2, Pencil, Rocket, Triangle, Workflow, X, type LucideIcon } from "lucide-react";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { SHIP_PROVIDER_LABEL, type ShipAction, type ShipDeployment, type ShipProvider, type ShipTarget, type ShipTargetStatus } from "../../../shared/origin-ship";
import { Notice, cardClass, ghostButton, iconButton, primaryButton } from "../origin-pages/ui";
import { ACTION_LABEL, STATE_DOT, STATE_LABEL, STATE_TONE, confirmText, hostOf, liveDeployment, productionUrl, timeAgo } from "./ship-model";

export const PROVIDER_ICON: Record<ShipProvider, LucideIcon> = { vercel: Triangle, netlify: Diamond, cloudflare: Cloud, "github-actions": Workflow };
const SHOWN = 5;
const small = "min-h-7 px-2 py-1 text-[12px]";

type Pending = { action: ShipAction; deployment?: ShipDeployment };

export function TargetCard({ target, status, loading, isAdmin, onEdit, onAct, onConnect }: {
  target: ShipTarget;
  status: ShipTargetStatus | undefined;
  loading: boolean;
  isAdmin: boolean;
  onEdit(): void;
  onAct(action: ShipAction, deploymentId?: string): Promise<string>;
  onConnect(): void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const Icon = PROVIDER_ICON[target.provider];
  const live = liveDeployment(status);
  const url = productionUrl(target, status);
  const rows = status?.deployments ?? [];
  const shown = expanded ? rows : rows.slice(0, SHOWN);

  const run = async () => {
    if (!pending) return;
    setWorking(true);
    setSaid(null);
    try {
      setSaid({ tone: "info", text: await onAct(pending.action, pending.deployment?.id) });
      setPending(null);
    } catch (cause) {
      setSaid({ tone: "danger", text: cause instanceof Error ? cause.message : "The provider refused" });
    } finally {
      setWorking(false);
    }
  };

  return (
    <article className={cn(cardClass, "flex min-w-0 flex-col p-3 motion-safe:animate-msg-in")} aria-label={target.name} data-ship-target={target._id}>
      <header className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary" title={SHIP_PROVIDER_LABEL[target.provider]}><Icon size={15} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-ink">{target.name}</h3>
            {live && <span className={cn("inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium", STATE_TONE[live.state])}><span className={cn("size-1.5 rounded-full", STATE_DOT[live.state])} />{STATE_LABEL[live.state]}</span>}
          </div>
          <p className="truncate text-[12px] text-ink-tertiary">{SHIP_PROVIDER_LABEL[target.provider]} · <span className="font-mono">{target.ref}</span> · <span className="font-mono">{target.branch}</span></p>
        </div>
        {isAdmin && <button type="button" className={iconButton} aria-label={`Edit ${target.name}`} title="Edit target" onClick={onEdit}><Pencil size={14} /></button>}
      </header>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {url ? <SiteLink url={url} /> : <span className="text-[12px] text-ink-tertiary">No production address yet</span>}
        {isAdmin && status?.connected && !pending && (
          <button type="button" className={cn(primaryButton, small, "ml-auto")} onClick={() => setPending({ action: "deploy" })}>
            <Rocket size={13} />{target.provider === "github-actions" ? "Run workflow" : "Deploy"}
          </button>
        )}
      </div>

      {pending && (
        <div className="mt-2.5 flex flex-col gap-2 rounded-lg bg-inset/60 p-2.5 motion-safe:animate-pop-in" role="group" aria-label="Confirm">
          <p className="text-[12.5px] text-ink">{confirmText(target, pending.action, pending.deployment)}</p>
          <div className="flex gap-2">
            <button type="button" className={cn(primaryButton, small)} disabled={working} onClick={() => void run()}>
              {working ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{pending.action === "deploy" ? "Deploy" : ACTION_LABEL[pending.action]}
            </button>
            <button type="button" className={cn(ghostButton, small)} disabled={working} onClick={() => setPending(null)}><X size={13} />Cancel</button>
          </div>
        </div>
      )}
      {said && <div className="mt-2.5" role={said.tone === "danger" ? "alert" : "status"}><Notice tone={said.tone}>{said.text}</Notice></div>}

      <div className="mt-3 border-t border-hairline/30 pt-2">
        {!status ? (
          <p className="py-2 text-[12px] text-ink-tertiary">{loading ? "Reading deployments…" : "Deployments unavailable."}</p>
        ) : !status.connected ? (
          <div className="flex flex-wrap items-center gap-2 py-1.5 text-[12.5px] text-ink-secondary">
            <KeyRound size={13} className="text-ink-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1">{status.error ?? `Add your ${SHIP_PROVIDER_LABEL[target.provider]} token to see and run deployments.`}</span>
            {!status.error && <button type="button" className={cn(ghostButton, small)} onClick={onConnect}>Open Integrations</button>}
          </div>
        ) : status.error ? (
          <p className="py-2 text-[12px] text-danger" role="alert">{status.error}</p>
        ) : !rows.length ? (
          <p className="py-2 text-[12px] text-ink-tertiary">No deployments yet.</p>
        ) : (
          <ol className="flex flex-col" aria-label={`${target.name} deployments`}>
            {shown.map((deployment) => (
              <DeploymentRow key={deployment.id} deployment={deployment} canAct={isAdmin && !pending}
                onAction={(action) => { setSaid(null); setPending({ action, deployment }); }} />
            ))}
          </ol>
        )}
        {rows.length > SHOWN && (
          <button type="button" className="mt-1 rounded text-[12px] text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </article>
  );
}

function SiteLink({ url }: { url: string }) {
  const { state, copy } = useCopyFeedback(url);
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <a href={url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 truncate rounded text-[12.5px] font-medium text-accent-text hover:underline">
        <span className="truncate">{hostOf(url)}</span><ExternalLink size={11} className="shrink-0" aria-hidden="true" />
      </a>
      <button type="button" className={cn(iconButton, "size-7")} aria-label="Copy address" title={state === "copied" ? "Copied" : "Copy address"} onClick={copy}>
        {state === "copied" ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      </button>
    </span>
  );
}

function DeploymentRow({ deployment, canAct, onAction }: { deployment: ShipDeployment; canAct: boolean; onAction(action: Exclude<ShipAction, "deploy">): void }) {
  const link = deployment.url ?? deployment.inspectUrl;
  const badge = deployment.current ? <span className="rounded-full bg-success/15 px-1.5 py-px font-medium text-success">Live</span>
    : <span className="rounded-full bg-raised px-1.5 py-px">{deployment.production ? "Production" : deployment.pullRequest ? `Preview #${deployment.pullRequest}` : "Preview"}</span>;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 border-b border-hairline/20 py-2 last:border-b-0" data-deployment={deployment.id}>
      <span className={cn("mt-[7px] size-2 rounded-full", STATE_DOT[deployment.state])} aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[12.5px] text-ink" title={deployment.commitMessage}>
          {deployment.commitMessage || (deployment.commitSha ? deployment.commitSha.slice(0, 7) : deployment.id.slice(0, 12))}
        </p>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-ink-tertiary">
          <span className={cn("font-medium", STATE_TONE[deployment.state])}>{STATE_LABEL[deployment.state]}</span>
          {badge}
          {deployment.commitSha && <code className="font-mono">{deployment.commitSha.slice(0, 7)}</code>}
          {deployment.branch && !deployment.production && <code className="max-w-[140px] truncate font-mono">{deployment.branch}</code>}
          <time className="tabular-nums" dateTime={new Date(deployment.createdAt).toISOString()}>{timeAgo(deployment.createdAt)}</time>
        </p>
      </div>
      <div className="flex items-center gap-1 max-sm:col-start-2 max-sm:col-end-4 max-sm:mt-1.5">
        {canAct && deployment.actions.map((action) => (
          <button key={action} type="button" className={cn(ghostButton, "min-h-7 px-2 py-0.5 text-[11.5px]")} onClick={() => onAction(action)}>{ACTION_LABEL[action]}</button>
        ))}
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className={cn(iconButton, "size-7")} aria-label={deployment.url ? "Open deployment" : "Open on the provider"} title={deployment.url ? hostOf(deployment.url) : "Open on the provider"}>
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </li>
  );
}
