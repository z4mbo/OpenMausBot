import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, ExternalLink, Github } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { originGitHub } from "@/lib/origin-github";
import { STACK, providerSource, stepState as baseState, type GitHubState, type StackStep, type StepState } from "@/lib/integration-stack";
import type { IntegrationStatus } from "../../../shared/integration-keys";
import { CheckButton, CheckResult, checkFailed, useCheckRevision, type CheckScope } from "./integration-check";
import { SocialAccounts } from "./SocialAccounts";

/** A step whose every connected key was just rejected by its provider is not done yet. */
function stepState(step: StackStep, integrations: readonly IntegrationStatus[], github: GitHubState, scope: CheckScope): StepState {
  const state = baseState(step, integrations, github);
  const connected = integrations.filter((integration) => step.providers.includes(integration.id) && integration.configured);
  return state === "done" && connected.length > 0 && connected.every((integration) => checkFailed(integration.id, scope)) ? "partial" : state;
}

/** Opens one integration's key form in the list under the checklist. */
export const INTEGRATION_FOCUS_EVENT = "origin:integration-focus";

export function focusIntegration(id: string): void {
  window.dispatchEvent(new CustomEvent(INTEGRATION_FOCUS_EVENT, { detail: id }));
}

function StepMark({ state }: { state: StepState }) {
  if (state === "done") return <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink"><Check size={12} strokeWidth={3} /></span>;
  return <span className={cn("size-5 shrink-0 rounded-full border-[1.5px]", state === "partial" ? "border-warning border-r-transparent" : "border-ink-tertiary/50")} />;
}

const SOURCE_LABEL = { yours: "Yours", incomplete: "Incomplete", none: "Not connected" } as const;

function sourceText(integration: IntegrationStatus): string {
  const source = providerSource(integration);
  if (source !== "shared") return SOURCE_LABEL[source];
  return integration.shared ? `Shared by ${integration.shared.by}` : "Shared";
}

function ProviderLine({ integration, canEdit, scope }: { integration: IntegrationStatus; canEdit: boolean; scope: CheckScope }) {
  const source = providerSource(integration);
  return (
    <li className="flex flex-col gap-1 py-1.5" data-stack-provider={integration.id}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", integration.configured ? "bg-success" : source === "incomplete" ? "bg-warning" : "bg-raised-hover")} />
        <span className="text-[13px] font-medium text-ink">{integration.label}</span>
        <span className={cn("rounded px-1.5 text-[11px]", source === "shared" ? "bg-accent/12 text-accent-text" : source === "yours" ? "bg-raised text-ink-secondary" : "text-ink-tertiary")}>{sourceText(integration)}</span>
        <span className="ml-auto flex items-center gap-0.5">
          {integration.configured && canEdit && <CheckButton id={integration.id} scope={scope} />}
          {canEdit && (
            <button type="button" onClick={() => focusIntegration(integration.id)}
              className="inline-flex min-h-7 items-center rounded-md px-2 text-[12px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink">
              {source === "yours" ? "Edit key" : "Add key"}
            </button>
          )}
          <a href={integration.help} target="_blank" rel="noreferrer" aria-label={`Get ${integration.label} keys`}
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[12px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink">
            Get keys<ExternalLink size={11} aria-hidden="true" />
          </a>
        </span>
      </div>
      <CheckResult id={integration.id} scope={scope} className="pl-3.5" />
    </li>
  );
}

function StepBody({ step, integrations, github, canEdit, scope }: { step: StackStep; integrations: readonly IntegrationStatus[]; github: GitHubState; canEdit: boolean; scope: CheckScope }) {
  if (step.id === "github") {
    return (
      <div className="flex flex-wrap items-center gap-2 py-1.5 text-[12.5px] text-ink-secondary">
        <Github size={13} aria-hidden="true" />
        <span className="min-w-0 flex-1">{github?.shared ? "Shared with every member of the workspace." : github?.connected ? "Connected on this computer only; share it so the workspace can use it." : "Not connected yet."}</span>
        <button type="button" onClick={() => document.querySelector("[data-workspace-github]")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="inline-flex min-h-7 items-center rounded-md px-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink">Open GitHub settings</button>
      </div>
    );
  }
  const providers = step.providers.flatMap((id) => integrations.filter((integration) => integration.id === id));
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y divide-hairline/25">{providers.map((integration) => <ProviderLine key={integration.id} integration={integration} canEdit={canEdit} scope={scope} />)}</ul>
      {step.id === "social" && <SocialAccounts integrations={integrations} canEdit={canEdit} />}
    </div>
  );
}

/** A workspace's guided setup: each service the project journey uses, whether it is connected, and by whom. */
export function ConnectStackChecklist({ teamId, canEdit }: { teamId: string | null; canEdit: boolean }) {
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [github, setGitHub] = useState<GitHubState>(null);
  const [open, setOpen] = useState<string | null>(null);
  const checks = useCheckRevision();
  const scope = { teamId };
  const load = useCallback(() => {
    void api<{ integrations: IntegrationStatus[] }>(`/api/integrations${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`).then((body) => setIntegrations(body.integrations), () => undefined);
    if (teamId) void originGitHub.workspace(teamId).then((status) => setGitHub({ connected: Boolean(status.login || status.shared), shared: Boolean(status.shared && !status.sharedStale) }), () => undefined);
  }, [teamId]);
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load, checks]);
  if (!integrations) return null;
  const steps = teamId ? STACK : STACK.filter((step) => step.id !== "github");
  const doneShown = steps.filter((step) => stepState(step, integrations, github, scope) === "done").length;
  const firstOpen = open ?? steps.find((step) => stepState(step, integrations, github, scope) !== "done")?.id ?? null;
  return (
    <section aria-label="Connect your stack" className="rounded-xl bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-medium text-ink">Connect your stack</h3>
        <span className="text-[12.5px] tabular-nums text-ink-secondary">{doneShown} of {steps.length} ready</span>
      </div>
      <div className="mt-2.5 flex gap-1" aria-hidden="true">
        {steps.map((step) => <span key={step.id} className={cn("h-1 flex-1 rounded-full transition-colors duration-(--motion-base)", stepState(step, integrations, github, scope) === "done" ? "bg-accent" : stepState(step, integrations, github, scope) === "partial" ? "bg-warning/60" : "bg-raised")} />)}
      </div>
      <ol className="-mx-1 mt-3 flex flex-col">
        {steps.map((step) => {
          const state = stepState(step, integrations, github, scope);
          const expanded = firstOpen === step.id;
          const connected = step.id === "github" ? (github?.shared ? ["Shared"] : github?.connected ? ["This computer"] : [])
            : step.providers.flatMap((id) => integrations.filter((integration) => integration.id === id && integration.configured)).map((integration) => integration.label);
          return (
            <li key={step.id} data-stack-step={step.id} className="rounded-lg">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? "" : step.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-raised/50 focus-visible:ring-1 focus-visible:ring-accent/60">
                <StepMark state={state} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13.5px] font-medium", state === "done" ? "text-ink-secondary" : "text-ink")}>{step.title}</span>
                  <span className="block truncate text-[12px] text-ink-tertiary">{step.unlocks}</span>
                </span>
                {connected.length > 0 && <span className="hidden max-w-[45%] truncate text-[12px] text-ink-secondary sm:block">{connected.join(", ")}</span>}
                <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-(--motion-fast) motion-reduce:transition-none", expanded && "rotate-90")} />
              </button>
              {expanded && (
                <div className="ml-[38px] mr-2 pb-2 motion-safe:animate-[rise_var(--motion-fast)_var(--ease-out)_backwards]">
                  <StepBody step={step} integrations={integrations} github={github} canEdit={canEdit} scope={scope} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
