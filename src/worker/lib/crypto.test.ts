import { describe, expect, it } from "vitest";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decryptSecret,
  encryptSecret,
  hashPassword,
  hexToBytes,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from "./crypto";

const MASTER_KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("encoding", () => {
  it("round-trips every byte value through base64", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips hex and rejects invalid input", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("zz")).toThrow();
  });
});

describe("tokens", () => {
  it("generates url-safe, unique tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = randomToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.length).toBeGreaterThanOrEqual(43);
      seen.add(t);
    }
    expect(seen.size).toBe(100);
  });

  it("computes the SHA-256 known-answer vector", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares in constant time semantics", () => {
    expect(timingSafeEqual("same-value", "same-value")).toBe(true);
    expect(timingSafeEqual("same-value", "same-valuf")).toBe(false);
    expect(timingSafeEqual("short", "longer-value")).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies a correct password at full production cost", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^pbkdf2\$sha256\$600000\$/);
    await expect(
      verifyPassword("correct horse battery staple", stored),
    ).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("password-one", 1_000);
    await expect(verifyPassword("password-two", stored)).resolves.toBe(false);
  });

  it("honours the iteration count recorded in the stored hash", async () => {
    const stored = await hashPassword("legacy", 1_000);
    expect(stored).toMatch(/^pbkdf2\$sha256\$1000\$/);
    await expect(verifyPassword("legacy", stored)).resolves.toBe(true);
  });

  it("returns false, never throws, on malformed stored values", async () => {
    for (const bad of [
      "",
      "plaintext",
      "pbkdf2$sha256$notanumber$AAAA$BBBB",
      "pbkdf2$sha256$1000$!!$!!",
      "argon2$sha256$1000$AAAA$BBBB",
    ]) {
      await expect(verifyPassword("anything", bad)).resolves.toBe(false);
    }
  });
});

describe("secrets at rest (AES-256-GCM)", () => {
  it("round-trips unicode plaintext", async () => {
    const stored = await encryptSecret(MASTER_KEY, "pässwörd → 秘密 🔑");
    expect(stored).toMatch(/^v1\$/);
    await expect(decryptSecret(MASTER_KEY, stored)).resolves.toBe(
      "pässwörd → 秘密 🔑",
    );
  });

  it("produces distinct ciphertexts for the same plaintext (fresh IV)", async () => {
    const a = await encryptSecret(MASTER_KEY, "same");
    const b = await encryptSecret(MASTER_KEY, "same");
    expect(a).not.toBe(b);
  });

  it("rejects tampering, wrong keys, and bad formats", async () => {
    const stored = await encryptSecret(MASTER_KEY, "sensitive");
    const parts = stored.split("$");
    const ct = parts[2] ?? "";
    const flipped = `${parts[0]}$${parts[1]}$${ct.slice(0, -2)}${ct.endsWith("AA") ? "BB" : "AA"}`;
    await expect(decryptSecret(MASTER_KEY, flipped)).rejects.toThrow();
    await expect(decryptSecret(OTHER_KEY, stored)).rejects.toThrow();
    await expect(decryptSecret(MASTER_KEY, "v2$AAAA$BBBB")).rejects.toThrow();
    await expect(decryptSecret("deadbeef", stored)).rejects.toThrow();
  });
});
