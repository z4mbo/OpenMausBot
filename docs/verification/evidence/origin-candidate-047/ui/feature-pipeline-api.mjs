import { api } from '/src/state/store';
import { pipelineServer as actual, rememberedCallerPhone as actualRemembered, rememberCallerPhone as actualRemember } from '/src/components/origin-pipeline/pipeline-api.ts';

const active = location.pathname === '/__features046.html';
let callerPhone = '';
const deny = async (name) => {
  globalThis.__featureFixture?.blocked.push({ kind: 'pipeline', name });
  throw new Error('The feature UI fixture blocks outreach; nothing was sent.');
};
export const pipelineServer = {
  channels: () => !active ? actual.channels() : new URLSearchParams(location.search).get('channels') === 'unknown'
    ? Promise.reject(new Error('Synthetic connection status unavailable'))
    : api('/api/origin/pipeline/channels').then((result) => result.channels),
  send: (input) => active ? deny('send') : actual.send(input),
  refresh: (input) => active ? deny('refresh') : actual.refresh(input),
};
export const rememberedCallerPhone = () => active ? callerPhone : actualRemembered();
export const rememberCallerPhone = (value) => {
  if (!active) return actualRemember(value);
  callerPhone = value;
  return true;
};
