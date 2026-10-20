export function statusResponse(path) {
  const now = Date.now();
  const channels = { email: false, sms: false, whatsapp: false, call: false, ai_call: false };
  if (path === '/api/auth/session') return { kind: 'loopback' };
  if (path === '/api/origin/pipeline/channels') return { channels };
  if (path === '/api/origin/broadcast/channels') return { channels: { x: false, bluesky: false, linkedin: false, facebook: false, instagram: false, tiktok: false } };
  if (path === '/api/origin/model-host') return { ready: true, computerName: 'Synthetic review computer', teams: ['fixture-team'], hosts: [{ teamId: 'fixture-team', hostId: 'fixture-host', sources: [{ sourceKey: 'fixture-source', sourceId: 'fixture-source', instanceId: 'claude', provider: 'claudeAgent', label: 'My Claude subscription', billing: 'subscription', models: ['sonnet', 'opus'], enabled: false, projectIds: ['fixture-project'], workspaceHead: false, capacity: 1 }] }], instances: [{ instanceId: 'claude', provider: 'claudeAgent', displayName: 'Claude subscription', available: true, billing: 'subscription', models: ['opus', 'sonnet'] }] };
  if (path === '/api/origin/model-host/catalog') return { ready: true, sources: [{ hostId: 'synthetic-mac', sourceId: 'synthetic-claude', ownerUserId: 'fixture-other', ownerName: 'Synthetic teammate', computerName: 'MacBook', provider: 'claudeAgent', label: 'Claude subscription', billing: 'subscription', models: ['sonnet', 'opus'], heartbeatAt: now, expiresAt: now + 60000, capacity: 1 }] };
  if (path === '/api/plan-usage') return { fetchedAt: new Date(now).toISOString(), providers: [{ id: 'claude', name: 'Synthetic Claude account', driver: 'claudeAgent', plan: 'Fixture allowance', ok: true, error: null, fiveHour: { available: true, usedPercent: 32, remainingPercent: 68, resetsAt: new Date(now + 3600000).toISOString() }, weekly: { available: true, usedPercent: 61, remainingPercent: 39, resetsAt: new Date(now + 86400000).toISOString() }, extra: [] }] };
  if (path === '/api/daily-api-budget') return { timeZone: 'Europe/Rome', day: 'synthetic', limitUsd: 3, resetsAt: new Date(now + 3600000).toISOString(), spentUsd: 0, reservedUsd: 0, unknownCost: false, agents: [] };
  if (path === '/api/desktop-capabilities') return {};
  return undefined;
}
