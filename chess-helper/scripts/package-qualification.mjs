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
const events = path.join(directory, "tracking-events.jsonl");
const publicCrops = path.join(directory, "public-board-crops");
await fs.mkdir(publicCrops);
await fs.writeFile(timings, "", { mode: 0o600 });
await fs.writeFile(events, "", { mode: 0o600 });
// Temporary diagnostics leave recognition, stability, chess validation and the
// engine unchanged. Renderer capture adds allowlisted stream metadata only;
// the native capture module is built from the unchanged production source.
const logger = `
let qualificationCapture: { sessionId: string; revision: number; action: string; started: number } | null = null;
let qualificationLastEvent = "";
const qualificationCalls = { local: 0, cloudRecognition: 0, cloudExplanation: 0 };
function qualificationCloud(cloud: CloudAI) {
  return {
    recognize(...args: Parameters<CloudAI["recognize"]>) {
      qualificationCalls.cloudRecognition++;
      return cloud.recognize(...args);
    },
    explain(...args: Parameters<CloudAI["explain"]>) {
      qualificationCalls.cloudExplanation++;
      return cloud.explain(...args);
    },
  };
}
function qualificationLocal(local: LocalRecognition) {
  return { recognize(...args: Parameters<LocalRecognition["recognize"]>) {
    qualificationCalls.local++;
    // Approved public-board qualification only. Production never writes frames.
    if (qualificationCalls.local <= 40) {
      const frame = args[0];
      try { writeFileSync(${JSON.stringify(publicCrops)} + "/" + qualificationCalls.local + ".jpg", Buffer.from(frame.image.split(",")[1], "base64"), { mode: 0o600 }); } catch {}
    }
    return local.recognize(...args);
  } };
}
function recordQualificationSnapshot(snapshot: Snapshot) {
  const event = {
    sessionId: snapshot.status.sessionId, revision: snapshot.status.revision,
    state: snapshot.status.state, running: snapshot.running,
    fen: snapshot.position?.fen ?? null,
    boardReader: snapshot.settings.boardReader,
    explanationsEnabled: snapshot.settings.explanationsEnabled,
    observationFrameId: snapshot.observation?.frameId ?? null,
    uncertainSquares: snapshot.observation?.uncertainSquares ?? [],
    candidates: snapshot.analysis?.candidates.map(c => c.variation[0]?.uci ?? null) ?? [],
    errorCode: snapshot.status.error?.code ?? null,
    calls: { ...qualificationCalls },
  };
  const key = JSON.stringify(event);
  if (key !== qualificationLastEvent) {
    qualificationLastEvent = key;
    try { appendFileSync(${JSON.stringify(events)}, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\\n", { mode: 0o600 }); } catch {}
  }
  if (!qualificationCapture || snapshot.status.sessionId !== qualificationCapture.sessionId) return;
  if (snapshot.status.state === "Paused" && !snapshot.status.error) {
    qualificationCapture = null;
    return;
  }
  if (!["Ready", "Needs correction"].includes(snapshot.status.state) && !snapshot.status.error) return;
  const measurement = qualificationCapture;
  const elapsedMs = performance.now() - measurement.started;
  qualificationCapture = null;
  const record = {
    at: new Date().toISOString(),
    endpoint: snapshot.status.state,
    action: measurement.action,
    captureRevision: measurement.revision,
    observationFrameId: snapshot.observation?.frameId ?? null,
    running: snapshot.running,
    calls: { ...qualificationCalls },
    elapsedMs,
    boardReader: snapshot.settings.boardReader,
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
for (const marker of ["function broadcast(snapshot: Snapshot) {", "function capture(command: CaptureCommand) {",
  "cloud: new CloudAI(() => store.apiKey()),", "local: new LocalRecognition(),"])
  if (source.split(marker).length !== 2) throw new Error("Qualification instrumentation marker changed");
await fs.writeFile(mainFile, 'import { appendFileSync, writeFileSync } from "node:fs";\n' +
  source.replace(protection, "window.setContentProtection(false);")
    .replace("function broadcast(snapshot: Snapshot) {", logger + "\nfunction broadcast(snapshot: Snapshot) {\n  recordQualificationSnapshot(snapshot);")
    .replace("cloud: new CloudAI(() => store.apiKey()),", "cloud: qualificationCloud(new CloudAI(() => store.apiKey())),")
    .replace("local: new LocalRecognition(),", "local: qualificationLocal(new LocalRecognition()),")
    .replace("function capture(command: CaptureCommand) {", `function capture(command: CaptureCommand) {
  if (["sample", "start"].includes(command.action) && command.selection &&
      (!qualificationCapture || qualificationCapture.sessionId !== command.sessionId || qualificationCapture.revision !== command.revision))
    qualificationCapture = { sessionId: command.sessionId, revision: command.revision, action: command.action, started: performance.now() };
`));

// Allowlisted track metadata only, from the copied renderer's own capture helper.
const captureFile = path.join(directory, "src/renderer/capture.ts");
const captureSource = await fs.readFile(captureFile, "utf8");
const requestMarker = "return navigator.mediaDevices.getDisplayMedia({ audio: false, video });";
if (captureSource.split(requestMarker).length !== 2) throw new Error("Qualification capture marker changed");
await fs.writeFile(captureFile, captureSource.replace(requestMarker, `return navigator.mediaDevices.getDisplayMedia({ audio: false, video }).then(stream => {
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings() as MediaTrackSettings & { cursor?: string };
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & { cursor?: string[] };
    const supported = navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints & { cursor?: boolean };
    console.info("QUALIFICATION_CAPTURE " + JSON.stringify({ cursor: settings.cursor ?? null,
      cursorCapabilities: capabilities.cursor ?? [], cursorSupported: supported.cursor ?? false,
      width: settings.width ?? null, height: settings.height ?? null, frameRate: settings.frameRate ?? null }));
    return stream;
  });`));
const sourceWithLogger = await fs.readFile(mainFile, "utf8");
await fs.writeFile(mainFile, sourceWithLogger.replace("function protect(window: BrowserWindow) {", `function protect(window: BrowserWindow) {
  window.webContents.on("console-message", details => {
    const prefix = "QUALIFICATION_CAPTURE ";
    if (details.message.startsWith(prefix)) {
      try { appendFileSync(${JSON.stringify(events)}, JSON.stringify({ at: new Date().toISOString(), captureTrack: JSON.parse(details.message.slice(prefix.length)) }) + "\\n", { mode: 0o600 }); } catch {}
    }
  });`));

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
  "Tracking events include public-board state, engine moves and local/cloud call counts; no keys or pixels.\n" +
  "Up to 40 explicitly selected public-board JPEG crops are retained separately in public-board-crops for visual review. Never select private content.\n" +
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
  events,
  publicCrops,
  app: path.join(directory, "release/mac-arm64/ChessHelperQualification.app"),
}));
