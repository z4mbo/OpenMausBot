export class BodyTooLarge extends Error {
  constructor() { super("Request too large"); }
}

export async function readBoundedJson(request: Pick<Request, "body">, maxBytes = 128000) {
  return JSON.parse(await readBoundedText(request, maxBytes));
}

// Bound bytes while reading, including chunked requests and multibyte text.
// A post-read string length check has already paid the unbounded allocation cost.
export async function readBoundedText(request: Pick<Request, "body">, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(request, maxBytes));
}

export async function readBoundedBytes(request: Pick<Request, "body">, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
