import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cloud, cloudAction, cloudMutation, setCloudUrl, useCloudSession, useCloudUrl } from "@/lib/origin-cloud";
import { setSessionToken } from "@/lib/origin-cloud/client";
import { refreshCloudLinks } from "@/lib/origin-cloud-links";
import { syncFromOrigin } from "@/lib/origin-sync";
import { PROJECT_LEAD_ROLE } from "@/lib/origin-teams";
import { activeWorkspaceId, switchWorkspace, workspaceHeadsOf } from "@/lib/origin-workspaces";
import { api, useStore, type Bot } from "@/state/store";
import type { CloudLinks } from "@/lib/origin-import";
import { cn } from "@/lib/cn";
import { shareSession } from "./OriginConnect";

const DEV_ORIGIN_URL = "http://127.0.0.1:3210";
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

const field = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-tertiary focus:border-focus";
const primary = "flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[13.5px] font-medium text-app transition-opacity hover:opacity-90 disabled:opacity-40";

function OriginMark() {
  return (
    <svg width="44" height="44" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#111111" />
      <circle cx="32" cy="32" r="17" stroke="white" strokeWidth="4" />
      <circle cx="32" cy="32" r="8" fill="white" />
    </svg>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center"><OriginMark /></div>
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
  const [server, setServer] = useState(url ?? DEV_ORIGIN_URL);
  const [advanced, setAdvanced] = useState(!url && !import.meta.env.DEV);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = inviteTokenFrom(invite);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (invite.trim() && !token) throw new Error("That invite link doesn't look right");
      setCloudUrl(server.trim() || null);
      const result = await withTimeout(mode === "signin"
        ? cloudAction<{ sessionToken: string }>("auth:login", { email: email.trim(), password, sessionToken: undefined })
        : cloudAction<{ sessionToken: string }>("auth:signup", { email: email.trim(), password, name: name.trim(), ...(token ? { inviteToken: token } : {}), sessionToken: undefined }), server.trim());
      setSessionToken(result.sessionToken);
      if (token) await cloudMutation("workspaces:acceptInvite", { token });
      await shareSession(server.trim(), result.sessionToken);
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
      <h1 className="mb-1 text-center text-[20px] font-semibold text-ink">{signup ? "Create your Origin account" : "Sign in to Origin"}</h1>
      <p className="mb-6 text-center text-[13px] text-ink-secondary">{signup ? "Your workspaces, projects and agents in one place." : "Pick up your workspaces where you left them."}</p>
      <form className="space-y-2.5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {signup && <input className={field} placeholder="Your name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />}
        <input className={field} type="email" placeholder="Email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className={field} type="password" placeholder="Password" autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
        <input className={field} placeholder="Invite link (optional)" value={invite} onChange={(event) => setInvite(event.target.value)} />
        {error && <p role="alert" className="px-1 text-[12.5px] text-danger">{error}</p>}
        <button type="submit" className={primary} disabled={busy || !email || !password || (signup && !name.trim())}>
          {busy && <Loader2 size={14} className="animate-spin" />}{signup ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-center text-[12.5px] text-ink-secondary">
        {signup ? "Already have an account? " : "New to Origin? "}
        <button type="button" className="font-medium text-ink hover:underline" onClick={() => { setMode(signup ? "signin" : "signup"); setError(""); }}>
          {signup ? "Sign in" : "Create an account"}
        </button>
      </p>
      <div className="mt-6 border-t border-hairline/40 pt-3">
        <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}
          className="mx-auto flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary">
          Server<ChevronDown size={12} className={cn("transition-transform", advanced && "rotate-180")} />
        </button>
        {advanced && <input className={cn(field, "mt-2 text-[12.5px]")} aria-label="Origin server address" value={server} onChange={(event) => setServer(event.target.value)} placeholder="https://your-deployment.convex.cloud" />}
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
      <h1 className="mb-1 text-center text-[20px] font-semibold text-ink">Welcome{session.user?.name ? `, ${session.user.name}` : ""}</h1>
      <p className="mb-6 text-center text-[13px] text-ink-secondary">You're not in a workspace yet. Create one, or join with an invite link.</p>
      <form className="space-y-2.5" onSubmit={(event) => { event.preventDefault(); void run(() => cloudMutation("workspaces:create", { name: name.trim() })); }}>
        <input className={field} placeholder="Workspace name" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className={primary} disabled={busy || !name.trim()}>Create workspace</button>
      </form>
      <div className="my-5 flex items-center gap-3 text-[11.5px] text-ink-tertiary"><span className="h-px flex-1 bg-hairline/40" />or<span className="h-px flex-1 bg-hairline/40" /></div>
      <form className="space-y-2.5" onSubmit={(event) => { event.preventDefault(); if (token) void run(() => cloudMutation("workspaces:acceptInvite", { token })); }}>
        <input className={field} placeholder="Paste an invite link" value={invite} onChange={(event) => setInvite(event.target.value)} />
        <button type="submit" className={cn(primary, "bg-raised text-ink")} disabled={busy || !token}>Join workspace</button>
      </form>
      {error && <p role="alert" className="mt-3 text-center text-[12.5px] text-danger">{error}</p>}
      <button type="button" onClick={() => void session.logout()} className="mx-auto mt-6 block text-[12px] text-ink-tertiary hover:text-ink-secondary">Sign out</button>
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
  const [empty, setEmpty] = useState(false);
  const running = useRef(false);

  const sync = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const workspaces = await cloud.workspaces.list();
      setEmpty(workspaces.length === 0);
      if (!workspaces.length) return;
      const projects = (await Promise.all(workspaces.map((workspace) => cloud.projects.listForUser(workspace._id)))).flat();
      const links = await api<CloudLinks>("/api/origin/cloud-links");
      const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
        const answer = await api<T & { bot?: Bot; chief?: Bot; members?: Bot[] }>(path, init);
        for (const bot of [answer.bot, answer.chief, ...(answer.members ?? [])]) if (bot) dispatch({ type: "botAdded", bot, preserveSelection: true });
        return answer;
      };
      const synced = await syncFromOrigin({ cloud: { workspaces, projects }, bots: bots.current, links, call, lead: PROJECT_LEAD_ROLE });
      await refreshCloudLinks();
      const linkedHeads = Object.keys(synced.links.workspaces);
      const created = synced.result.createdWorkspaces.map((workspace) => workspace.botId);
      const known = new Set([...linkedHeads, ...created]);
      if (!known.has(activeWorkspaceId() ?? "")) {
        const first = workspaceHeadsOf(bots.current).find((head) => known.has(head.id))?.id ?? created[0] ?? linkedHeads[0];
        if (first) switchWorkspace(first);
      }
    } catch {
      // A failed round leaves the app as it was; the next round retries.
    } finally {
      running.current = false;
    }
  }, [dispatch]);

  useEffect(() => {
    void shareSession(url, session.token);
  }, [url, session.token]);

  useEffect(() => {
    void sync();
    const timer = window.setInterval(() => void sync(), SYNC_EVERY_MS);
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [sync]);

  return empty ? <NoWorkspace onReady={() => void sync()} /> : null;
}

/** Origin comes first: the app opens on sign-in, then shows the account's workspaces. */
export function OriginGate({ children }: { children: ReactNode }) {
  const url = useCloudUrl();
  const session = useCloudSession();
  useEffect(() => {
    if (!url && import.meta.env.DEV) setCloudUrl(DEV_ORIGIN_URL);
  }, [url]);
  if (session.token && !session.ready) {
    return <main className="flex min-h-dvh items-center justify-center bg-app"><Loader2 size={18} className="animate-spin text-ink-tertiary" /></main>;
  }
  if (!session.user) return <SignIn />;
  return children;
}
