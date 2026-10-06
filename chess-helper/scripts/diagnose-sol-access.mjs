import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chess-helper-sol-access-"));
const reportFile = path.resolve("docs/sol-access-report.json");
const startedAt = Date.now();
try {
  const script = path.join(directory, "sol-access-check.cjs");
  await build({
    entryPoints: ["scripts/sol-access-check.ts"], outfile: script,
    bundle: true, platform: "node", format: "cjs", external: ["electron"],
  });
  const electron = createRequire(import.meta.url)("electron");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, [script, directory, reportFile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  let completed = false;
  try {
    const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    completed = Date.parse(report.generatedAt) >= startedAt
      && report.recognition?.model === "gpt-6.1-sol" && report.attempts === 1;
  } catch { /* A previous report never counts as a completed diagnostic. */ }
  if (!completed) console.error("The native Sol access diagnostic did not complete; no new API result is established.");
  process.exitCode = completed ? (code ?? 1) : 1;
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
