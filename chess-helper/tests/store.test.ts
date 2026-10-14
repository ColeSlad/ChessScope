import { vi, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../src/shared/contracts";
// Verify persistence behavior. macOS Keychain-backed encryption needs a separate native check.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) =>
      Buffer.from(value.split("").reverse().join("")),
    decryptString: (value: Buffer) =>
      value.toString().split("").reverse().join(""),
  },
}));
import { Store } from "../src/main/store";
it("persists validated settings and encrypted credentials across a store restart", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chess-helper-store-"));
  try {
    const store = new Store(dir);
    const settings = {
      ...DEFAULT_SETTINGS,
      recognition: { model: "gpt-6-astra" as const, effort: "high" as const },
    };
    store.save(settings, "test-secret-api-key");
    const persisted = readFileSync(path.join(dir, "preferences.json"), "utf8");
    expect(persisted).not.toContain("test-secret-api-key");
    expect(statSync(path.join(dir, "preferences.json")).mode & 0o777).toBe(
      0o600,
    );
    const reopened = new Store(dir);
    expect(reopened.settings).toEqual(settings);
    expect(reopened.apiKey()).toBe("test-secret-api-key");
    reopened.save(settings, "");
    expect(new Store(dir).hasApiKey).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects malformed settings without overwriting saved values", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chess-helper-store-"));
  try {
    const store = new Store(dir);
    store.save(DEFAULT_SETTINGS);
    expect(() =>
      store.save({
        ...DEFAULT_SETTINGS,
        recognition: { model: "unsupported", effort: "low" },
      } as never),
    ).toThrow();
    expect(new Store(dir).settings).toEqual(DEFAULT_SETTINGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("migrates saved settings to local reading while preserving credentials, tracking and shortcuts", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chess-helper-store-"));
  try {
    const { boardReader: _reader, explanationsEnabled: _enabled, ...legacy } = DEFAULT_SETTINGS;
    const settings = { ...legacy, automaticTracking: true, shortcuts: { ...legacy.shortcuts, toggle: "Command+Shift+B" } };
    writeFileSync(path.join(dir, "preferences.json"), JSON.stringify({ version: 1, settings,
      credential: Buffer.from("test-secret-api-key".split("").reverse().join("")).toString("base64") }));
    const store = new Store(dir);
    expect(store.settings).toEqual({ ...settings, boardReader: "local", explanationsEnabled: true });
    expect(store.apiKey()).toBe("test-secret-api-key");
    store.save({ ...store.settings, explanationsEnabled: false });
    const reopened = new Store(dir);
    expect(reopened.settings.boardReader).toBe("local");
    expect(reopened.settings.explanationsEnabled).toBe(false);
    expect(reopened.settings.automaticTracking).toBe(true);
    expect(reopened.apiKey()).toBe("test-secret-api-key");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
