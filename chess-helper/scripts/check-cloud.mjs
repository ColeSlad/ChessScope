import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "chess-helper-cloud-check-"),
);
try {
  const image = path.join(directory, "synthetic-board.jpg");
  execFileSync("swift", ["scripts/make-cloud-test-board.swift", image], {
    stdio: "inherit",
    timeout: 30000,
  });
  const script = path.join(directory, "cloud-check.cjs");
  await build({
    entryPoints: ["scripts/cloud-check.ts"],
    outfile: script,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  const electron = createRequire(import.meta.url)("electron");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      electron,
      [script, image, directory, path.resolve("docs/api-report.json")],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
  process.exitCode = code ?? 1;
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
