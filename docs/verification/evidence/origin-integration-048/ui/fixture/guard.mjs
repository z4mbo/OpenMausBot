const requests = [], blocked = [], actions = [];
globalThis.__origin048 = { requests, blocked, actions, scope: 'Actual merged components; synthetic queries/status; all writes and nonlocal requests blocked. No backend/provider/native/publication acceptance.' };
const actualFetch = fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  requests.push({ method, path: url.pathname });
  if (url.origin !== location.origin || !['GET', 'HEAD'].includes(method)) {
    blocked.push({ kind: 'http', method, path: url.pathname });
    throw new Error('The isolated preview blocks writes and external requests.');
  }
  return actualFetch(input, init);
};
document.addEventListener('click', event => {
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (anchor && new URL(anchor.href, location.href).origin !== location.origin) { event.preventDefault(); event.stopPropagation(); blocked.push({ kind: 'link' }); }
}, true);
globalThis.open = () => { blocked.push({ kind: 'window-open' }); return null; };
