import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const directory = await mkdtemp(path.join(tmpdir(), "chess-local-fixtures-"));
try {
  const file = path.join(directory, "evaluate.cjs");
  await build({ entryPoints: ["scripts/evaluate-local.ts"], outfile: file, bundle: true, platform: "node", format: "cjs", external: ["electron"] });
  const executable = process.argv.includes("--native") ? createRequire(import.meta.url)("electron") : process.execPath;
  process.exitCode = spawnSync(executable, [file, ...process.argv.slice(2), path.join(directory, "profile")], { stdio: "inherit" }).status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
