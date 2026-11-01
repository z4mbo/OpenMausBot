// Turns any thrown value into a short message that is safe to show to people.
// Convex errors arrive as "[CONVEX M(fn)] [Request ID: …] Server Error\nUncaught Error: <message>\n    at …";
// production deployments redact the message entirely. Both collapse to the useful sentence or the fallback.
const NETWORK = /failed to fetch|networkerror|load failed|network request failed|connection lost|fetch failed/i;

export function errorText(error: unknown, fallback = "Something went wrong. Try again."): string {
  const data = error && typeof error === "object" && "data" in error ? (error as { data: unknown }).data : undefined;
  if (typeof data === "string" && data.trim()) return clean(data) || fallback;
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") return clean((data as { message: string }).message) || fallback;
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return fallback;
  if (NETWORK.test(raw)) return "Can't reach the server. Check your connection.";
  return clean(raw) || fallback;
}

function clean(raw: string) {
  let text = raw;
  const uncaught = /Uncaught (?:Convex)?Error:\s*([\s\S]*)/.exec(text);
  if (uncaught) text = uncaught[1];
  else if (/\[CONVEX [^\]]*\]/.test(text) || /\[Request ID: [^\]]*\]/.test(text)) return "";
  text = text
    .replace(/\[CONVEX [^\]]*\]\s*/g, "")
    .replace(/\[Request ID: [^\]]*\]\s*/g, "")
    .split(/\n\s*at |\n\s*Called by /)[0]
    .replace(/^\s*Server Error\s*/i, "")
    .replace(/^(?:Uncaught )?(?:Convex)?Error:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^Server Error$/i.test(text) || text.length > 240) return "";
  return text;
}

// Explains why the browser refused a camera or microphone.
export function mediaErrorText(error: unknown, device: "microphone" | "camera" = "microphone"): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const Device = device === "camera" ? "Camera" : "Microphone";
  if (name === "NotAllowedError" || name === "SecurityError") return `${Device} access is blocked`;
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${device} found`;
  if (name === "NotReadableError" || name === "AbortError") return `${Device} is in use by another app`;
  return `${Device} unavailable`;
}
