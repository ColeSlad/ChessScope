import { app, nativeImage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CloudAI } from "../src/main/cloud";
import { Stockfish } from "../src/main/engine";
import { Store } from "../src/main/store";
import { aiSettingSchema } from "../src/shared/contracts";
import { fixtureManifestSchema, missingCoverage } from "./fixture-schema";
import { evaluate, type FixtureResult } from "./fixture-runner";

const [root, directory, mode] = process.argv.slice(2);
if (!root || !directory) throw new Error("Invalid fixture evaluation arguments");
app.setName("Chess Helper");
const preferences = path.join(app.getPath("appData"), "com.colesladowsky.chesshelper");
app.setPath("userData", path.join(directory, "profile"));
app.whenReady().then(async () => {
  app.dock?.hide();
  const manifestFile = path.join(root, "tests/fixtures/manifest.json");
  const fixtureDirectory = await fs.realpath(path.dirname(manifestFile));
  const rawManifest = await fs.readFile(manifestFile);
  const manifest = fixtureManifestSchema.parse(JSON.parse(rawManifest.toString("utf8")));
  if (!manifest.cases.length) throw new Error("No recorded Chess.com/Lichess crops. Automatic tracking cannot be qualified.");
  const missing = missingCoverage(manifest.cases);
  const recordings = [];
  for (const fixture of manifest.cases) {
    const file = await fs.realpath(path.join(fixtureDirectory, fixture.image));
    if (!file.startsWith(fixtureDirectory + path.sep)) throw new Error("Fixture path escapes the recording directory");
    const bytes = await fs.readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) throw new Error(`Checksum mismatch for ${fixture.id}`);
    const image = nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    if (image.isEmpty() || size.width !== fixture.recording.pixelWidth || size.height !== fixture.recording.pixelHeight)
      throw new Error(`Recording dimensions do not match ${fixture.id}`);
    recordings.push({ fixture, bytes });
  }
  console.log(JSON.stringify({ recordings: recordings.length, missingCoverage: missing }));
  if (mode === "preflight") { app.exit(missing.length ? 1 : 0); return; }
  if (missing.length) throw new Error("Fixture coverage is incomplete. Run --preflight and finish recording before making cloud requests.");
  const store = new Store(preferences);
  if (!store.hasApiKey) throw new Error("Save an API key in Chess Helper Settings before fixture evaluation.");
  const setting = aiSettingSchema.parse({ model: process.env.RECOGNITION_MODEL ?? "gpt-6.1-sol", effort: process.env.RECOGNITION_EFFORT ?? "low" });
  const cloud = new CloudAI(() => store.apiKey());
  const engineDirectory = path.join(root, "resources/stockfish");
  const engine = new Stockfish(path.join(engineDirectory, "stockfish"), engineDirectory);
  const results: FixtureResult[] = [];
  let exitCode = 1;
  try {
    // Sequential, bounded evaluation uses the same local engine and cloud client as the app.
    for (const { fixture, bytes } of recordings) {
      const result = await evaluate(fixture, bytes, setting, {
        recognize: (frame, orientation, ai, signal) => cloud.recognize(frame, orientation, ai, signal),
        analyze: (position, signal) => engine.analyze(position, signal),
      });
      results.push(result);
      console.log(JSON.stringify({ id: result.id, outcome: result.outcome, latencyMs: result.latencyMs }));
    }
    const hash = createHash("sha256");
    for (const source of ["src/main/cloud.ts", "src/main/session.ts", "src/core/position.ts", "src/core/stability.ts"]) {
      hash.update(source); hash.update(await fs.readFile(path.join(root, source)));
    }
    const correct = results.filter(r => r.outcome === "correct").length;
    const corrections = results.filter(r => r.outcome === "correction").length;
    const incorrect = results.filter(r => r.outcome === "incorrect").length;
    const errors = results.filter(r => r.outcome === "error").length;
    const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
    const report = {
      generatedAt: new Date().toISOString(), recognition: setting,
      manifestSha256: createHash("sha256").update(rawManifest).digest("hex"), implementationSha256: hash.digest("hex"),
      recordings: manifest.cases.map(({ id, sha256, site, tags, recording }) => ({ id, sha256, site, tags, recording })),
      total: results.length, accuracy: correct / results.length,
      placementAccuracy: results.some(r => r.recognitionMatches !== null) ? results.filter(r => r.recognitionMatches === true).length / results.filter(r => r.recognitionMatches !== null).length : null,
      correctionFrequency: corrections / results.length, knownIncorrect: incorrect, errors,
      coverageComplete: missing.length === 0, missingCoverage: missing,
      recordedFixturesPassed: missing.length === 0 && incorrect === 0 && errors === 0,
      // A recorded-input run alone never qualifies real-time capture or enables tracking.
      qualified: false, liveCaptureMeasured: false,
      releaseBlocker: "Measure live capture-to-ready latency and review this exact model/effort, manifest, and implementation before enabling automatic tracking.",
      latency: {
        medianMs: latencies[Math.ceil(latencies.length * 0.5) - 1],
        p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
        includes: "Cloud recognition, complete-state validation, local 1000 ms engine analysis for accepted confirmed positions. Excludes real-time capture delay and explanation latency.",
      }, results,
    };
    const reportFile = path.join(root, "docs", `fixture-report-${setting.model}-${setting.effort}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ total: report.total, accuracy: report.accuracy, correctionFrequency: report.correctionFrequency, knownIncorrect: incorrect, errors, recordedFixturesPassed: report.recordedFixturesPassed, qualified: false, latency: report.latency }));
    exitCode = report.recordedFixturesPassed ? 0 : 1;
  } finally { engine.shutdown(); }
  app.exit(exitCode);
}).catch(error => {
  // Preflight errors contain only fixture metadata; never expose API error objects.
  console.error(error instanceof Error ? error.message : "Fixture evaluation failed");
  app.exit(1);
});
