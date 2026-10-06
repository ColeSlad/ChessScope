import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

// Build only. Launch requires explicit approval because window screenshot
// protection is disabled for visual qualification of public analysis boards.
const root = process.cwd();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chess-helper-qualification-"));
for (const name of ["src", "tests", "scripts", "resources", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html"])
  await fs.cp(path.join(root, name), path.join(directory, name), { recursive: true });
await fs.symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");

const mainFile = path.join(directory, "src/main/index.ts");
const source = await fs.readFile(mainFile, "utf8");
const protection = "window.setContentProtection(true);";
if (source.split(protection).length !== 2)
  throw new Error("Expected exactly one production window-protection call");
const timings = path.join(directory, "capture-to-ready.jsonl");
await fs.writeFile(timings, "", { mode: 0o600 });
// Instrument only the temporary main-process shell. Recognition, capture,
// stability, chess validation and engine implementation remain byte-identical.
const logger = `
let qualificationCapture: { sessionId: string; started: number } | null = null;
function recordQualificationSnapshot(snapshot: Snapshot) {
  if (!qualificationCapture || snapshot.status.sessionId !== qualificationCapture.sessionId) return;
  if (snapshot.status.state === "Paused" && !snapshot.status.error) {
    qualificationCapture = null;
    return;
  }
  if (!["Ready", "Needs correction"].includes(snapshot.status.state) && !snapshot.status.error) return;
  const elapsedMs = performance.now() - qualificationCapture.started;
  qualificationCapture = null;
  const record = {
    at: new Date().toISOString(),
    endpoint: snapshot.status.state,
    elapsedMs,
    recognition: snapshot.settings.recognition,
    fen: snapshot.position?.fen ?? null,
    engineMs: snapshot.analysis?.elapsedMs ?? null,
    sourceWidth: snapshot.selection?.sourceWidth ?? null,
    sourceHeight: snapshot.selection?.sourceHeight ?? null,
    crop: snapshot.selection?.crop ?? null,
    errorCode: snapshot.status.error?.code ?? null,
  };
  try { appendFileSync(${JSON.stringify(timings)}, JSON.stringify(record) + "\\n", { mode: 0o600 }); } catch {}
}
`;
for (const marker of ["function broadcast(snapshot: Snapshot) {", "function capture(command: CaptureCommand) {"])
  if (source.split(marker).length !== 2) throw new Error("Qualification instrumentation marker changed");
await fs.writeFile(mainFile, 'import { appendFileSync } from "node:fs";\n' +
  source.replace(protection, "window.setContentProtection(false);")
    .replace("function broadcast(snapshot: Snapshot) {", logger + "\nfunction broadcast(snapshot: Snapshot) {\n  recordQualificationSnapshot(snapshot);")
    .replace("function capture(command: CaptureCommand) {", `function capture(command: CaptureCommand) {
  if (command.action === "sample" && command.selection &&
      (!qualificationCapture || qualificationCapture.sessionId !== command.sessionId))
    qualificationCapture = { sessionId: command.sessionId, started: performance.now() };
`));

const packageFile = path.join(directory, "package.json");
const manifest = JSON.parse(await fs.readFile(packageFile, "utf8"));
manifest.build.productName = "Chess Helper Qualification";
manifest.build.executableName = "ChessHelperQualification";
manifest.build.mac.extendInfo.ChessHelperQualificationBuild = true;
await fs.writeFile(packageFile, JSON.stringify(manifest, null, 2) + "\n");
await fs.writeFile(path.join(directory, "QUALIFICATION-ONLY.txt"),
  "Window screenshot protection is disabled in this temporary build.\n" +
  "Launch only after explicit approval, for public-board qualification.\n" +
  "Local timing records contain only public FEN, settings, crop dimensions, status and elapsed time.\n" +
  "Never distribute this build. Quit it and reopen the protected production app afterward.\n" +
  "The production source, app, DMG, ZIP, and automatic-tracking gate are not changed.\n");

const code = await new Promise((resolve, reject) => {
  const child = spawn("npm", ["run", "package:dir"], { cwd: directory, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", resolve);
});
if (code !== 0) throw new Error("Temporary qualification build failed");
console.log(JSON.stringify({
  qualificationOnly: true,
  launched: false,
  contentProtection: false,
  directory,
  timings,
  app: path.join(directory, "release/mac-arm64/ChessHelperQualification.app"),
}));
