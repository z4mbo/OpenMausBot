import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { cloud, cloudAction, cloudMutation, setCloudUrl, useCloudSession, useCloudUrl } from "@/lib/origin-cloud";
import { captureCloudSession, cloudQueryOnce, cloudUrl as cloudUrlNow, sessionStore, setSessionToken } from "@/lib/origin-cloud/client";
import { refreshCloudLinks } from "@/lib/origin-cloud-links";
import { exclusiveWithSync, onSyncRequest, syncFromOrigin } from "@/lib/origin-sync";
import { sharedAgentsRound } from "@/lib/origin-shared-agents";
import { PROJECT_LEAD_ROLE } from "@/lib/origin-teams";
import { activeWorkspaceId, setAccountWorkspaces, switchWorkspace, workspaceHeadsOf } from "@/lib/origin-workspaces";
import { api, useStore, type Bot } from "@/state/store";
import type { CloudLinks } from "@/lib/origin-import";
import { cn } from "@/lib/cn";
import { shareSession } from "./OriginConnect";
import { OriginLogo } from "./OriginLogo";
import { defaultOriginServer, originServerFor } from "@/lib/origin-cloud/servers";

const SYNC_EVERY_MS = 60_000;
const SIGN_IN_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, server: string): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error(`Can't reach the Origin server at ${server}`)), SIGN_IN_TIMEOUT_MS))]);
}

const errorText = (cause: unknown) => {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0]!.trim() || "Something went wrong";
};

/** An invite link (`…/join/<token>`) or a bare token. */
export function inviteTokenFrom(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const match = /\/join\/([A-Za-z0-9_-]+)/.exec(text) ?? /^([A-Za-z0-9_-]{8,})$/.exec(text);
  return match?.[1] ?? null;
}

const field = "h-11 w-full rounded-[11px] border border-hairline/60 bg-inset px-3.5 text-[14.5px] text-ink outline-none transition-[border-color] placeholder:text-ink-tertiary/80 focus:border-focus";
const primary = "mt-1 flex h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 text-[14.5px] font-semibold text-app transition-opacity hover:opacity-90 disabled:opacity-40";
const title = "text-center text-[26px] font-bold leading-tight tracking-[-0.03em] text-ink";
const subtitle = "mt-2 text-center text-[14px] text-ink-secondary";
const textLink = "font-semibold text-ink underline decoration-hairline underline-offset-[3px] hover:decoration-current";


function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex justify-between gap-2 text-[12.5px] font-semibold text-ink">{label}{hint && <span className="font-normal text-ink-tertiary">{hint}</span>}</span>
      {children}
    </label>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-start justify-center overflow-y-auto bg-app px-4 pb-8 pt-[clamp(40px,14vh,140px)]">
      <div className="relative w-full max-w-[400px]">
        <div className="mb-5 flex justify-center"><OriginLogo size={48} /></div>
        {children}
      </div>
    </main>
  );
}

function SignIn() {
  const url = useCloudUrl();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [server, setServer] = useState(url ?? defaultOriginServer());
  const [advanced, setAdvanced] = useState(!url && !import.meta.env.DEV);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = inviteTokenFrom(invite);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (invite.trim() && !token) throw new Error("That invite link doesn't look right");
      const backend = originServerFor(server);
      setCloudUrl(backend);
      const attempt = captureCloudSession();
      const result = await withTimeout(mode === "signin"
        ? cloudAction<{ sessionToken: string }>("auth:login", { email: email.trim(), password, sessionToken: undefined })
        : cloudAction<{ sessionToken: string }>("auth:signup", { email: email.trim(), password, name: name.trim(), ...(token ? { inviteToken: token } : {}), sessionToken: undefined }), backend);
      attempt.assertCurrent();
      if (token) await cloudMutation("workspaces:acceptInvite", { token, sessionToken: result.sessionToken });
      attempt.assertCurrent();
      await shareSession(backend, result.sessionToken, attempt);
      attempt.assertCurrent();
      setSessionToken(result.sessionToken);
      setPassword("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === "signup";
  return (
    <Shell>
      <h1 className={title}>{signup ? "Create your Origin account" : "Sign in to Origin"}</h1>
      <p className={cn(subtitle, "mb-7")}>{signup ? "Your workspaces, projects and agents in one place." : "Pick up your workspaces where you left them."}</p>
      <form className="grid gap-3.5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {signup && <Field label="Your name"><input className={field} placeholder="Alex Smith" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></Field>}
        <Field label="Email"><input className={field} type="email" placeholder="you@company.com" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Password"><input className={field} type="password" placeholder={signup ? "At least 10 characters" : "Your password"} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        <Field label="Invite link" hint="Optional"><input className={field} placeholder="Paste an invite link" value={invite} onChange={(event) => setInvite(event.target.value)} /></Field>
        {error && <p role="alert" className="rounded-[10px] bg-danger/10 px-3 py-2.5 text-[13px] text-danger">{error}</p>}
        <button type="submit" className={primary} disabled={busy || !email || !password || (signup && !name.trim())}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <>{signup ? "Create account" : "Sign in"}<ArrowRight size={16} /></>}
        </button>
      </form>
      <p className="mt-6 text-center text-[13.5px] text-ink-secondary">
        {signup ? "Already have an account? " : "New to Origin? "}
        <button type="button" className={textLink} onClick={() => { setMode(signup ? "signin" : "signup"); setError(""); }}>
          {signup ? "Sign in" : "Create an account"}
        </button>
      </p>
      <div className="mt-8 border-t border-hairline/50 pt-3">
        <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}
          className="mx-auto flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-tertiary hover:text-ink-secondary">
          Server<ChevronDown size={13} className={cn("transition-transform", advanced && "rotate-180")} />
        </button>
        {advanced && <input className={cn(field, "mt-2 h-10 text-[13px]")} aria-label="Origin server address" value={server} onChange={(event) => setServer(event.target.value)} placeholder="https://your-deployment.convex.cloud" />}
      </div>
    </Shell>
  );
}

function NoWorkspace({ onReady }: { onReady(): void }) {
  const session = useCloudSession();
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); onReady(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  const token = inviteTokenFrom(invite);
  return (
    <div className="fixed inset-0 z-[80]"><Shell>
      <h1 className={title}>Welcome{session.user?.name ? `, ${session.user.name}` : ""}</h1>
      <p className={cn(subtitle, "mb-7")}>You're not in a workspace yet. Create one, or join with an invite link.</p>
      <form className="grid gap-3.5" onSubmit={(event) => { event.preventDefault(); void run(() => cloudMutation("workspaces:create", { name: name.trim() })); }}>
        <Field label="Workspace name"><input className={field} placeholder="Your team" value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <button type="submit" className={primary} disabled={busy || !name.trim()}>Create workspace<ArrowRight size={16} /></button>
      </form>
      <div className="my-6 flex items-center gap-3 text-[12px] text-ink-tertiary"><span className="h-px flex-1 bg-hairline/50" />or<span className="h-px flex-1 bg-hairline/50" /></div>
      <form className="grid gap-3.5" onSubmit={(event) => { event.preventDefault(); if (token) void run(() => cloudMutation("workspaces:acceptInvite", { token })); }}>
        <Field label="Invite link"><input className={field} placeholder="Paste an invite link" value={invite} onChange={(event) => setInvite(event.target.value)} /></Field>
        <button type="submit" className={cn(primary, "border border-hairline/60 bg-raised text-ink")} disabled={busy || !token}>Join workspace</button>
      </form>
      {error && <p role="alert" className="mt-4 rounded-[10px] bg-danger/10 px-3 py-2.5 text-center text-[13px] text-danger">{error}</p>}
      <button type="button" onClick={() => void session.logout()} className="mx-auto mt-8 block rounded-lg px-2 py-1 text-[12.5px] text-ink-tertiary hover:text-ink-secondary">Sign out</button>
    </Shell></div>
  );
}

/** Keeps the app's workspaces and projects in step with the signed-in Origin account. */
export function OriginSync() {
  const { state, dispatch } = useStore();
  const session = useCloudSession();
  const url = useCloudUrl();
  const bots = useRef(state.bots);
  bots.current = state.bots;
  const instances = useRef(state.instances);
  instances.current = state.instances;
  const [empty, setEmpty] = useState(false);
  const [syncProblems, setSyncProblems] = useState<{ name: string; error: string }[]>([]);
  const syncRequest = useRef<() => Promise<void>>(async () => {});
  const hydrated = Boolean(state.hydrated);
  const sync = useCallback(() => syncRequest.current(), []);

  useEffect(() => {
    let active = true;
    let running = false;
    let requestedWhileRunning = false;
    const current = () => active && url === cloudUrlNow() && session.token === sessionStore.get();
    const assertCurrent = () => {
      if (!current()) throw new Error("Origin account changed during sync");
    };
    const guarded = async <T,>(work: () => Promise<T>): Promise<T> => {
      assertCurrent();
      const answer = await work();
      assertCurrent();
      return answer;
    };
    const request = async (): Promise<void> => {
      if (!current() || !hydrated || !url || !session.token) return;
      if (running) {
        requestedWhileRunning = true;
        return;
      }
      running = true;
      await exclusiveWithSync(async () => {
        try {
          await guarded(() => shareSession(url, session.token));
          const workspaces = await guarded(() => cloud.workspaces.list());
          setEmpty(workspaces.length === 0);
          if (!workspaces.length) return;
          const projects = (await guarded(() => Promise.all(workspaces.map((workspace) => cloud.projects.listForUser(workspace._id))))).flat();
          const links = await guarded(() => api<CloudLinks>("/api/origin/cloud-links"));
          const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
            const answer = await guarded(() => api<T & { bot?: Bot; chief?: Bot; members?: Bot[] }>(path, init));
            for (const bot of [answer.bot, answer.chief, ...(answer.members ?? [])]) if (bot) dispatch({ type: "botAdded", bot, preserveSelection: true });
            return answer;
          };
          const synced = await syncFromOrigin({ cloud: { workspaces, projects }, bots: bots.current, links, call, lead: PROJECT_LEAD_ROLE });
          assertCurrent();
          await sharedAgentsRound({
            call, bots: bots.current, instances: instances.current, projects,
            cloud: {
              query: (name, args) => guarded(() => cloudQueryOnce(name, args)),
              mutation: (name, args) => guarded(() => cloudMutation(name, args)),
            },
          }).catch(() => undefined);
          await guarded(() => refreshCloudLinks());
          const accountTeams = new Set(workspaces.map((workspace) => workspace._id));
          const linkedHeads = Object.entries(synced.links.workspaces).filter(([, teamId]) => accountTeams.has(teamId)).map(([headId]) => headId);
          const created = synced.result.createdWorkspaces.map((workspace) => workspace.botId);
          setAccountWorkspaces([...linkedHeads, ...created]);
          setSyncProblems(synced.result.failures);
          const known = new Set([...linkedHeads, ...created]);
          if (!known.has(activeWorkspaceId() ?? "")) {
            const first = workspaceHeadsOf(bots.current).find((head) => known.has(head.id))?.id ?? created[0] ?? linkedHeads[0];
            if (first) switchWorkspace(first);
          }
        } catch {
          return;
        } finally {
          running = false;
        }
      });
      if (requestedWhileRunning && current()) {
        requestedWhileRunning = false;
        await request();
      }
    };
    syncRequest.current = request;
    setEmpty(false);
    setSyncProblems([]);
    setAccountWorkspaces([]);
    void request();
    const timer = window.setInterval(() => void request(), SYNC_EVERY_MS);
    const onFocus = () => void request();
    window.addEventListener("focus", onFocus);
    const stopRequests = onSyncRequest(() => void request());
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); stopRequests(); };
  }, [dispatch, hydrated, url, session.token]);

  if (empty) return <NoWorkspace onReady={() => void sync()} />;
  if (!syncProblems.length) return null;
  return (
    <div role="status" className="fixed right-4 bottom-4 z-[60] max-w-[340px] rounded-xl border border-hairline/50 bg-panel px-4 py-3 text-[12.5px] text-ink-secondary">
      <p className="font-medium text-ink">{syncProblems.length === 1 ? "One project couldn't be loaded" : `${syncProblems.length} projects couldn't be loaded`}</p>
      <ul className="mt-1 space-y-0.5">{syncProblems.slice(0, 4).map((problem) => <li key={problem.name} className="truncate">{problem.name}: {problem.error}</li>)}</ul>
      <p className="mt-1 text-ink-tertiary">Retrying in a minute.</p>
    </div>
  );
}

/** Origin comes first: the app opens on sign-in, then shows the account's workspaces. */
export function OriginGate({ children }: { children: ReactNode }) {
  const url = useCloudUrl();
  const session = useCloudSession();
  useEffect(() => {
    if (!url) setCloudUrl(defaultOriginServer());
  }, [url]);
  if (session.token && !session.ready) {
    return <main className="flex min-h-dvh items-center justify-center bg-app"><Loader2 size={18} className="animate-spin text-ink-tertiary" /></main>;
  }
  if (!session.user) return <SignIn />;
  return children;
}
