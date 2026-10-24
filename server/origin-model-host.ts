import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { definitionHash, definitionOf } from "../shared/origin-shared-agents.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection, ProviderInstance } from "./contracts.ts";
import type { SelectableInstance } from "./default-model-selection.ts";
import { defaultOriginCloudFile, readOriginCloud, type OriginProjectFolder } from "./origin-cloud.ts";
import { cloudProjectFor } from "./origin-project-links.ts";
import { modelHostConnection } from "./origin-model-host-connection.ts";
import { createModelHostRoutes, type SourceSettings } from "./origin-model-host-routes.ts";
import { createModelHostState, modelHostOrigin, type ModelHostAccountState, type ModelHostSourceState } from "./origin-model-host-state.ts";
import { hostingRefusal, MODEL_HOST_NOT_READY, type HostedPort, type HostedSource, type HostedTurnInput, type HostedTurnOutcome, type HostedWork } from "./origin-model-host-types.ts";
import { createHostedWorker } from "./origin-model-host-worker.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { Store } from "./store.ts";

interface HostDeps {
  ready?: boolean | (() => boolean);
  loopbackOnly?: boolean;
  visible?(auth: RequestAuth, botId: string): boolean;
  store: Store;
  instances(): Promise<SelectableInstance[]>;
  instance(id: string): ProviderInstance | null | undefined;
  folder(projectId: string): OriginProjectFolder | null;
  preflight(botId: string, instance: ProviderInstance, model: string): Promise<void>;
  run(input: HostedTurnInput): Promise<HostedTurnOutcome>;
  connect?: (origin: string, sessionToken?: string) => HostedPort;
  files?: { state?: string; cloud?: string };
  now?: () => number;
  computerName?: string;
}

export function createOriginModelHost(deps: HostDeps) {
  const ready = () => typeof deps.ready === "function" ? deps.ready() : deps.ready === true;
  const requireReady = () => { if (!ready()) throw hostingRefusal(MODEL_HOST_NOT_READY, 503, "model_host_not_ready"); };
  const state = createModelHostState(deps.files?.state ?? join(DATA_DIR, "origin-model-host.json"));
  const cloudFile = deps.files?.cloud ?? defaultOriginCloudFile();
  const connect = deps.connect ?? modelHostConnection;
  const now = deps.now ?? Date.now;
  const computerName = (deps.computerName ?? hostname()).slice(0, 80) || "This computer";
  const workers = new Map<string, { version: string; worker: ReturnType<typeof createHostedWorker> }>();
  const registrations = new Map<string, Promise<ModelHostAccountState>>();
  type OwnerSession = { origin: string; token: string; userId: string; port: HostedPort; checkedAt: number };
  let session: OwnerSession | null = null;
  let checking: Promise<OwnerSession | null> | null = null;
  let ticking = false, stopped = false, timer: ReturnType<typeof setInterval> | undefined;

  const stopWorkers = () => { for (const entry of workers.values()) entry.worker.stop(); workers.clear(); };
  const currentSession = async (force = false) => {
    const cloud = readOriginCloud(cloudFile);
    if (!cloud.url || !cloud.sessionToken) { stopWorkers(); session = null; return null; }
    const origin = modelHostOrigin(cloud.url), token = cloud.sessionToken;
    if (deps.loopbackOnly && !(new URL(origin).protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname))) throw hostingRefusal("The model hosting verification fixture accepts only its isolated loopback backend");
    if (session?.origin !== origin || session.token !== token) { stopWorkers(); session = null; }
    if (session && !force && now() - session.checkedAt < 30_000) return session;
    if (checking) return checking;
    checking = (async () => {
      const port = connect(origin, token);
      const user = await port.query("auth:me", {}) as { _id?: string } | null;
      const fresh = readOriginCloud(cloudFile);
      if (!user?._id || fresh.url !== cloud.url || fresh.sessionToken !== token) { stopWorkers(); session = null; return null; }
      if (session && session.userId !== user._id) stopWorkers();
      return session = { origin, token, userId: user._id, port, checkedAt: now() };
    })().finally(() => { checking = null; });
    return checking;
  };
  const requireSession = async () => {
    const current = await currentSession();
    if (!current) throw hostingRefusal("Sign in to Origin to choose or share a model account", 401, "model_host_origin_signin");
    return current;
  };
  const accounts = (current: NonNullable<typeof session>) => state.accounts().filter(account => account.origin === current.origin && account.userId === current.userId);
  const isCurrent = (account: ModelHostAccountState, token: string) => {
    const cloud = readOriginCloud(cloudFile);
    try { return ready() && !stopped && Boolean(cloud.url) && modelHostOrigin(cloud.url!) === account.origin && cloud.sessionToken === token && session?.userId === account.userId; }
    catch { return false; }
  };
  const directory = (path: string | null | undefined): path is string => {
    try { return Boolean(path && isAbsolute(path) && statSync(path).isDirectory()); } catch { return false; }
  };

  const inspect = async (account: ModelHostAccountState, work: HostedWork) => {
    if (/<attached-(?:image|file|audio)\b/i.test(work.text)) throw hostingRefusal("Hosted requests must contain text without another computer's attachment capabilities");
    const live = state.account(account.origin, account.userId, account.teamId), source = live?.sources[work.sourceKey];
    if (!live || live.hostId !== account.hostId || !source?.enabled || source.sourceId !== work.sourceId || source.provider !== work.provider || !source.models.includes(work.model) ||
        (work.projectId ? !source.projectIds.includes(work.projectId) : !source.workspaceHead)) throw hostingRefusal("The account is no longer shared with this request");
    const matches = deps.store.bots.filter(bot => !bot.hidden && bot.shared?.teamId === work.teamId && bot.shared.agentId === work.agentId);
    if (matches.length !== 1) throw hostingRefusal("Bind this shared agent on the account owner's computer before running it");
    const bot = matches[0]!;
    if (bot.shared?.review || definitionHash(work.definition) !== work.definitionHash || definitionHash(definitionOf(bot, work.definition.look)) !== work.definitionHash) throw hostingRefusal("Review the shared agent definition on this computer first");
    const projectId = cloudProjectFor(deps.store.bots, readOriginCloud(cloudFile).projects, bot.id);
    if ((projectId ?? undefined) !== work.projectId) throw hostingRefusal("The shared agent's local project binding changed");
    const cwd = work.projectId ? deps.folder(work.projectId)?.path : bot.cwd;
    if (!directory(cwd)) throw hostingRefusal("Choose an existing local project folder on the model account owner's computer");
    const instance = deps.instance(source.instanceId);
    if (!instance?.enabled || instance.driverKind !== source.provider || instance.adapter.capabilities.guestTurns !== "confined" || !(instance.models.default === work.model || instance.models.options.some(model => model.id === work.model))) throw hostingRefusal("The offered local model account cannot safely run this confined shared request");
    const snapshot = await instance.snapshot();
    const billing = snapshot.billing ?? (snapshot.account?.method === "api-key" ? "metered" : "unknown");
    if (snapshot.state !== "available" || snapshot.authenticated === false || source.billing === "subscription" && billing !== "subscription" || billing !== "subscription" && !work.allowMetered) throw hostingRefusal("The offered account's authentication or billing changed");
    await deps.preflight(bot.id, instance, work.model);
    return { botId: bot.id, instanceId: instance.instanceId, cwd };
  };

  const tick = async () => {
    if (!ready() || ticking || stopped) return;
    ticking = true;
    try {
      const current = await currentSession();
      if (!current) return;
      const instances = await deps.instances();
      const wanted = new Set<string>();
      for (const account of accounts(current)) {
        const sources = Object.values(account.sources);
        if (!sources.some(source => source.enabled)) continue;
        wanted.add(account.hostId);
        const version = JSON.stringify(account), old = workers.get(account.hostId);
        if (old && old.version !== version) { old.worker.stop(); workers.delete(account.hostId); }
        const port = connect(account.origin);
        let entry = workers.get(account.hostId);
        if (!entry) {
          entry = { version, worker: createHostedWorker({ account, port, current: () => isCurrent(account, current.token),
            inspect: work => inspect(account, work), run: deps.run, now }) };
          workers.set(account.hostId, entry);
        }
        const reports = sources.filter(source => source.sourceId).map(source => {
          const instance = instances.find(instance => instance.instanceId === source.instanceId && instance.driverKind === source.provider);
          const billing = instance?.snapshot.billing ?? (instance?.snapshot.account?.method === "api-key" ? "metered" : "unknown");
          const available = source.enabled && deps.instance(source.instanceId)?.adapter.capabilities.guestTurns === "confined" && instance?.enabled !== false && instance?.snapshot.state === "available" && instance.snapshot.authenticated !== false &&
            (source.billing !== "subscription" || billing === "subscription");
          const offered = new Set(instance ? [instance.models.default, ...instance.models.options.map(model => model.id)] : []);
          return { sourceId: source.sourceId!, available, models: available ? source.models.filter(model => offered.has(model)) : [] };
        });
        await port.mutation("modelHosts:heartbeat", { hostId: account.hostId, hostToken: account.hostToken, online: true, sources: reports });
        if (!isCurrent(account, current.token)) { entry.worker.stop(); continue; }
        const pending = await port.query("modelHosts:pending", { hostId: account.hostId, hostToken: account.hostToken, now: now() }) as HostedWork[];
        for (const work of pending) entry.worker.offer(work);
      }
      for (const [hostId, entry] of workers) if (!wanted.has(hostId)) { entry.worker.stop(); workers.delete(hostId); }
    } finally { ticking = false; }
  };

  const catalog = async (botId: string): Promise<HostedSource[]> => {
    if (!ready()) return [];
    const bot = deps.store.bot(botId);
    if (!bot?.shared || bot.hidden) return [];
    const current = await requireSession();
    const projectId = cloudProjectFor(deps.store.bots, readOriginCloud(cloudFile).projects, bot.id);
    const sources = await current.port.query("modelHosts:catalog", { teamId: bot.shared.teamId, ...(projectId ? { projectId } : {}), now: now() }) as HostedSource[];
    return sources.filter(source => source.expiresAt > now() && source.heartbeatAt <= now() + 5_000);
  };
  const validateSelection = async (botId: string, selection: ModelSelection, allowMetered = false) => {
    requireReady();
    if (selection.instanceId !== "origin-remote" || !selection.source) throw hostingRefusal("Choose a concrete Origin model account");
    const source = (await catalog(botId)).find(source => source.hostId === selection.source!.hostId && source.sourceId === selection.source!.sourceId && source.models.includes(selection.model));
    if (!source) throw hostingRefusal("That teammate's model account is offline or no longer shared with this project");
    if (source.billing !== "subscription" && !allowMetered) throw hostingRefusal("Paid teammate API fallback needs your explicit permission", 409, "model_host_paid_consent");
    return source;
  };

  const settings = async () => {
    if (!ready()) return { ready: false, reason: MODEL_HOST_NOT_READY, computerName, teams: [], hosts: [], instances: [] };
    const current = await requireSession(), instances = await deps.instances();
    return { ready: true, computerName, teams: [...new Set(deps.store.bots.flatMap(bot => bot.shared ? [bot.shared.teamId] : []))],
      hosts: accounts(current).map(account => ({ hostId: account.hostId, teamId: account.teamId, sources: Object.values(account.sources) })),
      instances: instances.map(instance => ({ instanceId: instance.instanceId, provider: instance.driverKind, displayName: instance.instanceId,
        available: deps.instance(instance.instanceId)?.adapter.capabilities.guestTurns === "confined" && instance.enabled !== false && instance.snapshot.state === "available" && instance.snapshot.authenticated !== false,
        billing: instance.snapshot.billing ?? "unknown", models: [...new Set([instance.models.default, ...instance.models.options.map(model => model.id)].filter(Boolean))].slice(0, 100) })) };
  };
  const save = async (input: SourceSettings) => {
    requireReady();
    const current = await requireSession(), instances = await deps.instances();
    let account = state.account(current.origin, current.userId, input.teamId);
    const previous = input.sourceKey ? account?.sources[input.sourceKey] : undefined;
    if (input.sourceKey && !previous) throw hostingRefusal("No such account grant on this computer", 404);
    if (previous && previous.instanceId !== input.instanceId) throw hostingRefusal("Choose a new account grant to change its local provider binding");
    const instance = instances.find(instance => instance.instanceId === input.instanceId);
    if ((!instance || instance.enabled === false || instance.snapshot.state !== "available" || instance.snapshot.authenticated === false || deps.instance(input.instanceId)?.adapter.capabilities.guestTurns !== "confined") && input.enabled) throw hostingRefusal("Choose an available account whose driver supports confined shared turns");
    const offered = new Set(instance ? [instance.models.default, ...instance.models.options.map(model => model.id)] : previous?.models ?? []);
    if (input.enabled && input.models.some(model => !offered.has(model))) throw hostingRefusal("Choose only models currently offered by that account");
    if (!account) {
      const key = JSON.stringify([current.origin, current.userId, input.teamId]);
      let registering = registrations.get(key);
      if (!registering) {
        registering = (async () => {
          const registration = await current.port.mutation("modelHosts:register", { teamId: input.teamId, deviceId: state.deviceId(), name: computerName, capacity: 8 }) as { hostId: string; hostToken: string | null };
          if (!registration.hostToken) throw hostingRefusal("This computer was registered without its saved local secret. Revoke that computer grant before registering it again.");
          const fresh = { origin: current.origin, userId: current.userId, teamId: input.teamId, hostId: registration.hostId, hostToken: registration.hostToken, sources: {} };
          state.put(fresh);
          return fresh;
        })();
        registrations.set(key, registering);
      }
      try { account = await registering; } finally { if (registrations.get(key) === registering) registrations.delete(key); }
    }
    const source: ModelHostSourceState = { sourceKey: previous?.sourceKey ?? randomUUID(), ...(previous?.sourceId ? { sourceId: previous.sourceId } : {}),
      instanceId: input.instanceId, provider: instance?.driverKind ?? previous!.provider, label: input.label,
      billing: instance?.snapshot.billing ?? previous?.billing ?? "unknown", models: input.models, enabled: input.enabled, projectIds: input.projectIds,
      workspaceHead: input.workspaceHead, capacity: input.capacity };
    const { instanceId: _localBinding, sourceId: _oldId, ...grant } = source;
    const sourceId = await current.port.mutation("modelHosts:setSource", { hostId: account.hostId, ...grant }) as string;
    source.sourceId = sourceId;
    const latest = state.account(account.origin, account.userId, account.teamId);
    if (!latest || latest.hostId !== account.hostId || !isCurrent(account, current.token)) throw hostingRefusal("The account changed while saving its model grant");
    state.put({ ...latest, sources: { ...latest.sources, [source.sourceKey]: source } });
    workers.get(account.hostId)?.worker.stop(); workers.delete(account.hostId);
    void tick().catch(() => undefined);
    return source;
  };
  const revoke = async (teamId: string) => {
    requireReady();
    const current = await requireSession(), account = state.account(current.origin, current.userId, teamId);
    if (!account) throw hostingRefusal("No computer grant for this workspace", 404);
    await current.port.mutation("modelHosts:revoke", { hostId: account.hostId });
    state.put({ ...account, sources: Object.fromEntries(Object.entries(account.sources).map(([key, source]) => [key, { ...source, enabled: false }])) });
    workers.get(account.hostId)?.worker.stop(); workers.delete(account.hostId);
  };
  return { catalog, validateSelection, settings, save, revoke, tick,
    routes: createModelHostRoutes({ ready, reason: MODEL_HOST_NOT_READY, settings, save, revoke, catalog, visible: deps.visible ?? (() => false) }),
    start(): void { if (!ready() || timer || stopped) return; timer = setInterval(() => void tick().catch(() => undefined), 15_000); timer.unref?.(); },
    stop(): void { stopped = true; clearInterval(timer); stopWorkers(); },
  };
}
