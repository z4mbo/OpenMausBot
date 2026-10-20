export * from '/scripts/testing/origin-pages-cloud.ts';
import { fixtureCalls, useCloudQuery as fixtureQuery } from '/scripts/testing/origin-pages-cloud.ts';
import { leads, replies } from '/__data048.mjs';

export function useCloudQuery(name: string, args: Record<string, unknown> | 'skip') {
  const value = fixtureQuery(name, args);
  if (args === 'skip' || value === undefined) return value;
  if (name === 'pipeline:lead') return { lead: leads.find(lead => lead._id === args.leadId), activities: args.leadId === 'fixture-lead' ? replies : [] };
  if (name === 'pipelineSequences:forLead' && args.leadId !== 'fixture-lead') return null;
  return value;
}

export async function cloudMutation(name: string, args: Record<string, unknown> = {}): Promise<never> {
  fixtureCalls.push({ name, args });
  globalThis.__origin048?.blocked.push({ kind: 'cloud', name });
  throw new Error('The isolated UI preview blocks writes. Nothing was saved, sent or published.');
}
export const cloudAction = cloudMutation;
