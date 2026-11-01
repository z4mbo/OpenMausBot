// Client address for rate limits. X-Real-IP / X-Forwarded-For are only trusted when ORIGIN_TRUSTED_PROXY is set,
// i.e. the operator runs a reverse proxy that overwrites them (see deploy/README.md). Without it callers fall back
// to per-endpoint keys that a client cannot change by sending a header.

function trustedProxy() {
  const value = (process.env.ORIGIN_TRUSTED_PROXY || "").trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false";
}

export function clientAddress(request: Request): string | null {
  if (!trustedProxy()) return null;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  // The proxy appends the address it saw; earlier entries come from the client.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map(part => part.trim()).filter(Boolean);
  return forwarded?.length ? forwarded[forwarded.length - 1]!.slice(0, 64) : null;
}
