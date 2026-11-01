const callHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
};

// Desktop requests use explicit bearer tokens and never ambient cookie credentials.
export function callJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(callHeaders)) headers.set(name, value);
  return Response.json(body, { ...init, headers });
}

export function callOptions() {
  return new Response(null, { status: 204, headers: callHeaders });
}
