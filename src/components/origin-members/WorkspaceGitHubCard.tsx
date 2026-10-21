import { useCallback, useEffect, useRef, useState } from "react";
import { Github, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { openExternalLink } from "@/lib/app-links";
import { cloudAction } from "@/lib/origin-cloud";
import { originGitHub, type GitHubWorkspaceStatus } from "@/lib/origin-github";

const button = "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-opacity disabled:cursor-not-allowed disabled:opacity-50";

/** The workspace's GitHub as every member sees it, with connect and share for owners and admins. */
export function WorkspaceGitHubCard({ teamId, onStatus }: { teamId: string; onStatus?(status: GitHubWorkspaceStatus): void }) {
  const [status, setStatus] = useState<GitHubWorkspaceStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const reported = useRef(onStatus);
  reported.current = onStatus;
  const refresh = useCallback(() => originGitHub.workspace(teamId).then((next) => { setStatus(next); setError(""); reported.current?.(next); }, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))), [teamId]);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(done);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const shared = status?.shared;
  return (
    <div data-workspace-github className="flex flex-col gap-2 rounded-lg px-2 py-2">
      <div className="flex items-center gap-2.5 text-[13.5px]">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", shared ? "bg-success" : status?.login ? "bg-warning" : "bg-raised-hover")} />
        <Github size={14} aria-hidden="true" className="text-ink-secondary" />
        <span className="flex-1 font-medium text-ink">GitHub for the workspace</span>
        {!status && !error && <Loader2 size={13} className="animate-spin text-ink-tertiary" aria-label="Loading" />}
      </div>
      {status && (
        <p className="pl-[22px] text-[12.5px] leading-relaxed text-ink-secondary">
          {shared && !status.canManage
            ? <>GitHub is connected for this workspace by {shared.sharedByName}; you can use it. Repositories live in <strong className="text-ink">@{shared.accountLogin}</strong>, and you and your agents create repositories, open issues and push through it, without access to anyone's GitHub account.</>
            : shared
            ? <>Repositories live in <strong className="text-ink">@{shared.accountLogin}</strong>, shared by {shared.sharedByName}. Every member and their agents create repositories, open issues and push through it, without access to anyone's GitHub account.</>
            : status.login
              ? <>Connected as <strong className="text-ink">@{status.login}</strong> on this computer only. Share it so the rest of the workspace can use it.</>
              : status.canManage ? "Connect GitHub once; every member of the workspace then works through it." : "Not set up yet. An owner or admin connects it once, and then it works for everyone."}
        </p>
      )}
      {status?.sharedStale && <p className="pl-[22px] text-[12.5px] text-warning">The admin who connected it is no longer an admin here, so it stopped working until an owner or admin reconnects it.</p>}
      {status?.shareError && <p role="alert" className="pl-[22px] text-[12.5px] text-danger">{status.shareError}</p>}
      {error && <p role="alert" className="pl-[22px] text-[12.5px] text-danger">{error}</p>}
      {notice && <p className="pl-[22px] text-[12.5px] text-ink-secondary">{notice}</p>}
      {shared && <PersonalGitHub teamId={teamId} linkedLogin={status?.linkedLogin ?? null} onChange={() => void refresh()} />}
      {status?.canManage && (
        <div className="flex flex-wrap gap-2 pl-[22px]">
          {status.canShare && (
            <button type="button" disabled={busy} className={cn(button, "bg-accent font-medium text-accent-ink hover:opacity-90")}
              onClick={() => void run(() => originGitHub.shareWorkspace(teamId), "Shared. Every member of the workspace can use GitHub now.")}>Share with the workspace</button>
          )}
          {status.localApp && (
            <button type="button" disabled={busy} className={cn(button, shared || status.canShare ? "bg-control text-ink hover:bg-raised-hover" : "bg-accent font-medium text-accent-ink hover:opacity-90")}
              onClick={() => void run(() => originGitHub.connectWorkspace(teamId), "Finish connecting in your browser, then come back here.")}>{status.login || shared ? "Reconnect GitHub" : "Connect GitHub"}</button>
          )}
          {!status.localApp && !shared && status.canSetup && (
            <button type="button" disabled={busy} className={cn(button, "bg-accent font-medium text-accent-ink hover:opacity-90")}
              onClick={() => void run(() => originGitHub.setupApp(teamId), "Finish creating the App in your browser, then come back here.")}>Create GitHub App</button>
          )}
          {(status.login || shared) && (
            <button type="button" disabled={busy} className={cn(button, "bg-control text-danger hover:bg-raised-hover")}
              onClick={() => { if (window.confirm("Disconnect GitHub from the whole workspace? Members and agents lose access until it is connected again.")) void run(() => originGitHub.disconnectWorkspace(teamId), "GitHub disconnected from the workspace."); }}>Disconnect</button>
          )}
        </div>
      )}
    </div>
  );
}

type DeviceStart = { userCode: string; verificationUri: string; interval: number; expiresAt: number };
type DeviceAnswer = { state: "pending" } | { state: "linked"; login: string; invited: number };

/** A member's own GitHub account, proven through GitHub's device sign-in, so their pushes and pull requests show as them. */
function PersonalGitHub({ teamId, linkedLogin, onChange }: { teamId: string; linkedLogin: string | null; onChange(): void }) {
  const [code, setCode] = useState<DeviceStart | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const poll = async (started: DeviceStart) => {
    while (live.current && Date.now() < started.expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, started.interval * 1000));
      const answer = await cloudAction<DeviceAnswer>("githubLinks:finishLink", { teamId });
      if (answer.state === "linked") {
        setMessage(answer.invited ? `Linked @${answer.login}. GitHub sent you ${answer.invited === 1 ? "an invitation" : `${answer.invited} invitations`} to push; accept ${answer.invited === 1 ? "it" : "them"} on GitHub.` : `Linked @${answer.login}.`);
        return;
      }
    }
    throw new Error("The GitHub sign-in expired. Start again.");
  };
  const link = async () => {
    setBusy(true);
    setMessage("");
    try {
      const started = await cloudAction<DeviceStart>("githubLinks:startLink", { teamId });
      setCode(started);
      await openExternalLink(started.verificationUri);
      await poll(started);
      onChange();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0] : String(cause));
    } finally {
      if (live.current) { setBusy(false); setCode(null); }
    }
  };
  return (
    <div className="flex flex-col gap-1.5 pl-[22px] text-[12.5px] text-ink-secondary">
      {linkedLogin
        ? <p>Your GitHub: <strong className="text-ink">@{linkedLogin}</strong>. Your pushes and pull requests show as you. <button type="button" className="text-ink-tertiary underline-offset-2 hover:text-ink hover:underline" onClick={() => void cloudAction("githubLinks:unlink", { teamId }).then(onChange)}>Unlink</button></p>
        : <p>Optional: link your own GitHub account so your pushes and pull requests show as you. Without it, you and your agents still work through the workspace's GitHub.</p>}
      {code && <p>Enter <strong className="select-all font-mono text-ink">{code.userCode}</strong> on the GitHub page that opened.</p>}
      {message && <p>{message}</p>}
      {!linkedLogin && (
        <button type="button" disabled={busy} onClick={() => void link()} className={cn(button, "self-start bg-control text-ink hover:bg-raised-hover")}>
          {busy && <Loader2 size={13} className="animate-spin" />}Link my GitHub
        </button>
      )}
    </div>
  );
}
