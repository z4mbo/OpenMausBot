import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, ShieldCheck, Square } from "lucide-react";
import type { EngineInstallScript, EngineScriptInstallJob } from "../../shared/engine-script-install";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStore, type InstanceInfo } from "@/state/store";

const POLL_MS = 700;

function installPath(instanceId: string): string {
  return `/api/engine-installs/${encodeURIComponent(instanceId)}`;
}

export function ScriptInstallConfirmDetails({ script }: { script: EngineInstallScript }) {
  return (
    <dl className="mt-4 space-y-2 text-[12px]">
      <div>
        <dt className="text-ink-secondary">{t("engineSetup.script.command")}</dt>
        <dd>
          <code data-script-install-command className="mt-1 block select-all break-all rounded-lg border border-hairline/50 bg-app px-2.5 py-2 font-mono text-[11.5px] text-ink">
            {script.command}
          </code>
        </dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="text-ink-secondary">{t("engineSetup.script.source")}</dt>
        <dd data-script-install-source className="font-medium text-ink">{script.source}</dd>
      </div>
      <div>
        <a href={script.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
          <ExternalLink size={12} /> {t("engineSetup.script.officialGuide")}
        </a>
      </div>
    </dl>
  );
}

export function ScriptEngineInstall({
  instance,
  script,
  compact = false,
  onFinished,
}: {
  instance: InstanceInfo;
  script: EngineInstallScript;
  compact?: boolean;
  onFinished?: (instances: InstanceInfo[]) => void;
}) {
  const { dispatch, refreshModels } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [job, setJob] = useState<EngineScriptInstallJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const running = job?.state === "running";

  useEffect(() => {
    let alive = true;
    api(installPath(instance.instanceId))
      .then(({ job: current }) => {
        if (alive && (current as EngineScriptInstallJob).state === "running") setJob(current as EngineScriptInstallJob);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [instance.instanceId]);

  useEffect(() => {
    if (!running) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const { job: next } = await api(installPath(instance.instanceId));
        if (alive) setJob(next as EngineScriptInstallJob);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [running, instance.instanceId]);

  const jobState = job?.state;
  useEffect(() => {
    if (!jobState || jobState === "running") return;
    let alive = true;
    void (async () => {
      try {
        const { instances } = await api("/api/instances");
        const list = (instances ?? []) as InstanceInfo[];
        if (!alive) return;
        if (list.length) dispatch({ type: "instances", instances: list });
        finished.current?.(list);
        const installed = list.find((candidate) => candidate.instanceId === instance.instanceId);
        if (jobState === "succeeded" && installed?.snapshot.state !== "available") {
          setError(t("engineSetup.installNotVerified", { reason: installed?.snapshot.reason ?? t("engineSetup.noReason") }));
        }
        if (jobState === "succeeded") await refreshModels(instance.instanceId).catch(() => {});
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobState, instance.instanceId, dispatch, refreshModels]);

  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [job?.output]);

  const start = async () => {
    setConfirming(false);
    setError(null);
    try {
      const { job: started } = await api(installPath(instance.instanceId), { method: "POST", body: "{}" });
      setJob(started as EngineScriptInstallJob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const cancel = async () => {
    setStopping(true);
    try {
      const { job: stopped } = await api(installPath(instance.instanceId), { method: "DELETE", body: "{}" });
      setJob(stopped as EngineScriptInstallJob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStopping(false);
    }
  };

  const failure = error ?? (job?.state === "failed" ? job.error ?? null : null);

  return (
    <div className={cn(compact ? "contents" : "mt-3 space-y-2")}>
      {!running && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={compact
            ? "flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-opacity duration-150"
            : "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white hover:brightness-110"}
        >
          <Download size={compact ? 12 : 14} />
          {compact ? t("onboarding.engines.install") : t("engineSetup.script.install", { name: instance.displayName })}
        </button>
      )}
      {job && (
        <div data-script-install-progress className={cn("space-y-1.5", compact && "basis-full pl-[30px]")}>
          {running && (
            <div className="flex items-center gap-2 text-[11.5px] text-ink-secondary">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span role="status" className="min-w-0 flex-1">{t("engineSetup.script.running", { source: script.source })}</span>
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={stopping}
                className="flex shrink-0 items-center gap-1 rounded-md bg-control px-2 py-1 text-[11px] font-medium text-ink hover:bg-raised-hover disabled:opacity-60"
              >
                <Square size={10} />
                {t("engineSetup.script.cancel")}
              </button>
            </div>
          )}
          {job.output && (
            <pre
              ref={outputRef}
              aria-label={t("engineSetup.script.output")}
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-hairline/50 bg-app px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-ink-secondary"
            >
              {job.output}
            </pre>
          )}
          {job.state === "succeeded" && !failure && (
            <p role="status" className="text-[11px] text-success">{t("engineSetup.installVerified")}</p>
          )}
          {job.state === "cancelled" && !failure && (
            <p role="status" className="text-[11px] text-ink-secondary">{t("engineSetup.script.cancelled")}</p>
          )}
        </div>
      )}
      {failure && (
        <p role="alert" className={cn("whitespace-pre-wrap text-[11.5px] leading-relaxed text-danger", compact && "basis-full pl-[30px]")}>{failure}</p>
      )}
      <ConfirmDialog
        open={confirming}
        tone="neutral"
        icon={<ShieldCheck size={18} />}
        title={t("engineSetup.script.confirmTitle", { name: instance.displayName })}
        body={t("engineSetup.script.confirmBody", { name: instance.displayName, source: script.source })}
        details={<ScriptInstallConfirmDetails script={script} />}
        confirmLabel={t("engineSetup.script.confirm")}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void start()}
      />
    </div>
  );
}
