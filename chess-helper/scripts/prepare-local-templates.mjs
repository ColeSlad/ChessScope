import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const directory = await mkdtemp(path.join(tmpdir(), "chess-local-templates-"));
try {
  const file = path.join(directory, "prepare.cjs");
  await build({ entryPoints: ["scripts/prepare-local-templates.ts"], outfile: file, bundle: true, platform: "node", format: "cjs" });
  process.exitCode = spawnSync(process.execPath, [file], { stdio: "inherit" }).status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
