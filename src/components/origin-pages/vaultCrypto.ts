/** Must stay byte-compatible with origin-workspace lib/vaultCrypto.ts: both clients read the same Convex `credentials` rows. */
export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
  kdf: string;
};

export const VAULT_ITERATIONS = 210_000;
export const VAULT_KDF = "PBKDF2-SHA256/AES-256-GCM";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto is required for vault encryption");
  const keyMaterial = await crypto.subtle.importKey("raw", toArrayBuffer(encoder.encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(secret: string, passphrase: string, iterations = VAULT_ITERATIONS): Promise<EncryptedSecret> {
  if (!passphrase) throw new Error("Vault passphrase required");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(encoder.encode(secret)));
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations,
    kdf: VAULT_KDF,
  };
}

export async function decryptSecret(payload: EncryptedSecret, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error("Vault passphrase required");
  const key = await deriveKey(passphrase, base64ToBytes(payload.salt), payload.iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(payload.iv)) },
    key,
    toArrayBuffer(base64ToBytes(payload.ciphertext)),
  );
  return decoder.decode(plaintext);
}

export function generatePassword(length = 32): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (n) => alphabet[n % alphabet.length]).join("");
}
