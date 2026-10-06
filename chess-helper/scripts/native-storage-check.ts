import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/main/store";
import { DEFAULT_SETTINGS } from "../src/shared/contracts";

const directory = process.argv[2];
const phase = process.argv[3];
if (!directory || !["write", "read"].includes(phase))
  throw new Error("Invalid storage check arguments");
app.setName("Chess Helper Storage Check");
app.setPath("userData", path.join(directory, "electron-profile"));
app
  .whenReady()
  .then(() => {
    app.dock?.hide();
    assert(
      safeStorage.isEncryptionAvailable(),
      "Native safeStorage is unavailable",
    );
    const store = new Store(path.join(directory, "preferences"));
    const dummy = "disposable-chess-helper-test-credential";
    const settings = {
      ...DEFAULT_SETTINGS,
      recognition: { ...DEFAULT_SETTINGS.recognition, effort: "high" as const },
    };
    if (phase === "write") store.save(settings, dummy);
    const file = path.join(directory, "preferences/preferences.json");
    assert(
      !fs.readFileSync(file, "utf8").includes(dummy),
      "Credential was stored as plaintext",
    );
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(store.apiKey(), dummy);
    assert.deepEqual(store.settings, settings);
    console.log(`Native encrypted storage ${phase} passed.`);
    app.quit();
  })
  .catch(() => {
    console.error(
      "Native encrypted storage check failed. Check macOS Keychain access.",
    );
    app.exit(1);
  });
