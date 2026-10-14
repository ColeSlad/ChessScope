import fs from "node:fs";
import { createHash } from "node:crypto";
import jpeg from "jpeg-js";
import { LocalBoardReader, type BoardProfile } from "../src/core/local-vision";
import templates from "../src/data/local-templates.json";
import { fixtureManifestSchema, missingCoverage } from "./fixture-schema";
import { evaluate, type FixtureResult } from "./fixture-runner";
import { DEFAULT_SETTINGS, type BoardObservation, type CapturedFrame, type Orientation } from "../src/shared/contracts";

async function main() {
  const native = process.argv.includes("--native");
  const reportRequested = process.argv.includes("--report");
  let nativeApp: import("electron").App | undefined;
  let captureVariant: ((bytes: Buffer, width: number) => Buffer) | undefined;
  let recognizer: { recognize(frame: CapturedFrame, orientation: Orientation, signal: AbortSignal): Promise<BoardObservation> };
  if (native) {
    const { app, nativeImage } = await import("electron");
    nativeApp = app;
    app.setPath("userData", process.argv.at(-1)!);
    await app.whenReady();
    app.dock?.hide();
    const { LocalRecognition } = await import("../src/main/local-recognition");
    recognizer = new LocalRecognition();
    captureVariant = (bytes, width) => nativeImage.createFromBuffer(bytes).resize({ width, height: width, quality: "best" }).toJPEG(90);
  } else {
    const reader = new LocalBoardReader(templates.profiles as BoardProfile[]);
    recognizer = { recognize: async (frame, orientation) => {
      const bytes = Buffer.from(frame.image.split(",")[1], "base64");
      const image = { ...jpeg.decode(bytes, { useTArray: true }), order: "rgba" as const };
      const observed = reader.read(image, orientation);
      return { sessionId: frame.sessionId, revision: frame.revision, frameId: frame.frameId,
        placements: observed.placements, orientation: observed.orientation,
        uncertainSquares: observed.uncertainSquares, boardVisible: observed.boardVisible, cropAligned: observed.cropAligned };
    } };
  }
  const rawManifest = fs.readFileSync("tests/fixtures/manifest.json");
  const manifest = fixtureManifestSchema.parse(JSON.parse(rawManifest.toString()));
  const missing = missingCoverage(manifest.cases);
  const results: (FixtureResult & { training: boolean })[] = [];
  const captureVariants: { width: number; results: FixtureResult[] }[] = [];
  for (const fixture of manifest.cases) {
    const bytes = fs.readFileSync(`tests/fixtures/${fixture.image}`);
    if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) throw new Error(`Changed recording ${fixture.id}`);
    const result = await evaluate(fixture, bytes, DEFAULT_SETTINGS.recognition, {
      recognize: (frame, orientation, _setting, signal) => recognizer.recognize(frame, orientation, signal),
      // This is a recognition/complete-state benchmark, not an engine latency measurement.
      analyze: async position => ({ ...position, candidates: [], elapsedMs: 0, terminal: null }),
    });
    results.push({ ...result, engineMs: null, training: templates.training.some(t => t.id === fixture.id) });
    console.log(JSON.stringify({ id: fixture.id, outcome: result.outcome, matches: result.recognitionMatches,
      recognitionMs: result.recognitionMs }));
  }
  const summarize = (rows: FixtureResult[]) => ({ total: rows.length,
    correct: rows.filter(r => r.outcome === "correct").length,
    correction: rows.filter(r => r.outcome === "correction").length,
    incorrect: rows.filter(r => r.outcome === "incorrect").length,
    error: rows.filter(r => r.outcome === "error").length });
  const counts = summarize(results);
  const heldOut = summarize(results.filter(r => !r.training));
  const readableMisses = manifest.cases.filter(f => !f.expectsCorrection && !f.tags.includes("checkmate") &&
    !f.tags.includes("stalemate") && results.find(r => r.id === f.id)?.outcome !== "correct").map(f => f.id);
  const timings = results.map(r => r.recognitionMs).sort((a,b) => a-b);
  const hash = createHash("sha256");
  const sources = ["src/core/local-vision.ts", "src/main/local-recognition.ts", "src/data/local-templates.json",
    "src/core/position.ts", "src/core/stability.ts", "src/main/session.ts", "src/core/tracking-policy.ts", "src/shared/contracts.ts"];
  for (const file of sources) { hash.update(file); hash.update(fs.readFileSync(file)); }
  if (captureVariant && process.argv.includes("--capture-variants")) {
    for (const width of [512, 1024]) {
      const rows: FixtureResult[] = [];
      for (const fixture of manifest.cases) {
        const bytes = captureVariant(fs.readFileSync(`tests/fixtures/${fixture.image}`), width);
        const result = await evaluate(fixture, bytes, DEFAULT_SETTINGS.recognition, {
          recognize: (frame, orientation, _setting, signal) => recognizer.recognize(frame, orientation, signal),
          analyze: async position => ({ ...position, candidates: [], elapsedMs: 0, terminal: null }),
        });
        rows.push({ ...result, engineMs: null });
      }
      captureVariants.push({ width, results: rows });
      console.log(JSON.stringify({ derivedCaptureWidth: width, counts: summarize(rows) }));
    }
  }
  const unsafeVariants = captureVariants.flatMap(v => v.results.filter(r => r.outcome === "incorrect" || r.outcome === "error").map(r => `${v.width}:${r.id}`));
  const sessionReplay = native && process.argv.includes("--session")
    ? await (await import("./local-session-check")).checkLocalSession(process.cwd(), recognizer)
    : null;
  const passed = !missing.length && !counts.incorrect && !counts.error && !readableMisses.length && !unsafeVariants.length;
  const report = {
    generatedAt: new Date().toISOString(), reader: "local-template-v1", runtime: native ? "Electron nativeImage / Apple Silicon" : "Node / jpeg-js test decoder",
    profiles: templates.profiles.map(p => ({ id: p.id, label: p.label })), training: templates.training,
    templateSha256: createHash("sha256").update(fs.readFileSync("src/data/local-templates.json")).digest("hex"),
    manifestSha256: createHash("sha256").update(rawManifest).digest("hex"), implementationSha256: hash.digest("hex"), implementationFiles: sources,
    counts, heldOut, missingCoverage: missing, readableMisses, recordedFixturesPassed: passed,
    qualified: false, liveCaptureMeasured: false, cloudRequests: 0,
    limits: "Supports the recorded default green/neo Chess.com and brown/cburnett Lichess themes. Obscuring terminal badges, unknown themes, incomplete crops, displaced pieces and missed moves require correction. Orientation is the user-selected orientation, validated by legal continuation after initial confirmation.",
    captureVariants: { description: "Derived stress inputs: original recordings resized to square canvases and JPEG quality 90, as in capture. These are not new live recordings or Retina capture evidence.", unsafeVariants, runs: captureVariants },
    sessionReplay,
    latency: { medianMs: timings[Math.ceil(timings.length * 0.5) - 1], p95Ms: timings[Math.ceil(timings.length * 0.95) - 1], maxMs: timings.at(-1),
      includes: "JPEG decoding, normalized piece matching, and validated observation construction. Excludes capture/stability wait, Stockfish, optional explanations and UI rendering." }, results,
  };
  if (reportRequested) fs.writeFileSync(native ? "docs/local-recognition-report.json" : "docs/local-recognition-node-report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ runtime: report.runtime, counts, heldOut, recordedFixturesPassed: passed, readableMisses,
    qualified: false, cloudRequests: 0, latency: report.latency }));
  if (nativeApp) nativeApp.exit(passed ? 0 : 1);
  else process.exitCode = passed ? 0 : 1;
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Local fixture evaluation failed");
  process.exit(1);
});
