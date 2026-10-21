const KEY_BYTES = 32;
const IV_BYTES = 12;

export const SEALING_MISSING = "The Origin backend has no ORIGIN_SEALING_KEY, so workspace integrations cannot be stored. The deployment owner sets it with `npx convex env set ORIGIN_SEALING_KEY <32 random bytes, base64>`.";

function decodeKey(raw: string): Uint8Array<ArrayBuffer> | null {
  const value = raw.trim();
  if (/^[a-f0-9]{64}$/i.test(value)) return Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
    return bytes.length === KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export function sealingConfigured(): boolean {
  return Boolean(process.env.ORIGIN_SEALING_KEY && decodeKey(process.env.ORIGIN_SEALING_KEY));
}

async function sealingKey(): Promise<CryptoKey> {
  const bytes = process.env.ORIGIN_SEALING_KEY ? decodeKey(process.env.ORIGIN_SEALING_KEY) : null;
  if (!bytes) throw new Error(SEALING_MISSING);
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/**
 * Security: AES-256-GCM under the deployment's ORIGIN_SEALING_KEY, which never leaves the Convex environment. The
 * purpose is bound as associated data, so a sealed value cannot be replayed into another row or another team.
 */
export async function seal(value: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(purpose) }, await sealingKey(), new TextEncoder().encode(value)));
  const out = new Uint8Array(IV_BYTES + ciphertext.length);
  out.set(iv);
  out.set(ciphertext, IV_BYTES);
  return toBase64(out);
}

export async function unseal(sealed: string, purpose: string): Promise<string> {
  const data = fromBase64(sealed);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, IV_BYTES), additionalData: new TextEncoder().encode(purpose) }, await sealingKey(), data.subarray(IV_BYTES));
  return new TextDecoder().decode(plain);
}
