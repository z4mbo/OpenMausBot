import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, VAULT_ITERATIONS, VAULT_KDF } from "./vaultCrypto";

describe("vault crypto", () => {
  it("round-trips a secret with the original scheme's parameters", async () => {
    const payload = await encryptSecret("hunter2 — ünïcode ✓", "correct horse battery");
    expect(payload.iterations).toBe(VAULT_ITERATIONS);
    expect(payload.kdf).toBe(VAULT_KDF);
    expect(atob(payload.salt)).toHaveLength(16);
    expect(atob(payload.iv)).toHaveLength(12);
    await expect(decryptSecret(payload, "correct horse battery")).resolves.toBe("hunter2 — ünïcode ✓");
  });

  it("uses a fresh salt and iv for every encryption", async () => {
    const [a, b] = await Promise.all([encryptSecret("same", "passphrase!", 1000), encryptSecret("same", "passphrase!", 1000)]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses the wrong passphrase", async () => {
    const payload = await encryptSecret("secret", "right passphrase", 1000);
    await expect(decryptSecret(payload, "wrong passphrase")).rejects.toThrow();
  });
});
