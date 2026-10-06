import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "chess-helper-native-storage-"),
);
try {
  const script = path.join(directory, "check.cjs");
  await build({
    entryPoints: ["scripts/native-storage-check.ts"],
    outfile: script,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  const electron = createRequire(import.meta.url)("electron");
  for (const phase of ["write", "read"])
    execFileSync(electron, [script, directory, phase], {
      timeout: 20000,
      stdio: "inherit",
    });
  console.log(
    "Verified macOS safeStorage encryption, file permissions, settings persistence, and decryption across separate process launches.",
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
