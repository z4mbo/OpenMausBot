export const localAppOrigin = () => window.location.origin;
export function navigateLocalApp(url: string) {
  window.location.assign(url);
}

export async function localFetch(path: string, sessionToken: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${sessionToken}`);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}

export async function localApi<T>(path: string, sessionToken: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const response = await localFetch(path, sessionToken, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Request failed");
  return payload as T;
}
