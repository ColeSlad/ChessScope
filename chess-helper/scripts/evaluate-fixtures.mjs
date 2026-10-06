import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chess-helper-fixtures-"));
try {
  const script = path.join(directory, "fixture-check.cjs");
  await build({
    entryPoints: ["scripts/fixture-check.ts"], outfile: script,
    bundle: true, platform: "node", format: "cjs", external: ["electron"],
  });
  const electron = createRequire(import.meta.url)("electron");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, [script, process.cwd(), directory, process.argv.includes("--preflight") ? "preflight" : "evaluate"], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
