import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chess-helper-permission-"));
try {
  const script = path.join(directory, "check.cjs");
  await build({ entryPoints: ["scripts/capture-permission-check.ts"], outfile: script,
    bundle: true, platform: "node", format: "cjs", external: ["electron"] });
  const electron = createRequire(import.meta.url)("electron");
  for (const phase of ["old", "fixed"])
    execFileSync(electron, [script, directory, phase], { timeout: 20000, stdio: "inherit" });
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
