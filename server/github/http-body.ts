import type { IncomingMessage } from "node:http";

export class BodyTooLarge extends Error {
  constructor() { super("Request too large"); }
}

/** Rejects once `maxBytes` is passed and keeps draining without retaining, so the 413 can still be written. */
export function readBoundedText(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer | string) => {
      if (over) return;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(bytes);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

export async function readBoundedJson(req: IncomingMessage, maxBytes = 128_000): Promise<Record<string, unknown>> {
  const text = await readBoundedText(req, maxBytes);
  const value: unknown = text ? JSON.parse(text) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}
