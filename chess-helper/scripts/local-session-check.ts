import fs from "node:fs";
import path from "node:path";
import { Session } from "../src/main/session";
import { Stockfish } from "../src/main/engine";
import { DEFAULT_SETTINGS, type BoardObservation, type CapturedFrame, type Orientation } from "../src/shared/contracts";
import { placementKey, placementsOf } from "../src/core/position";
import { trackingPreviewAvailable } from "../src/core/tracking-policy";
import { fixtureManifestSchema } from "./fixture-schema";
import manifest from "../tests/fixtures/manifest.json";

type Recognizer = { recognize(frame: CapturedFrame, orientation: Orientation, signal: AbortSignal): Promise<BoardObservation> };
const waitFor = async (condition: () => boolean) => {
  const deadline = performance.now() + 6000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error("Recorded local session did not reach its expected endpoint");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

export async function checkLocalSession(root: string, recognizer: Recognizer) {
  const results = [];
  const fixtures = fixtureManifestSchema.parse(manifest).cases;
  for (const [site, ids] of [
    ["lichess", ["lichess-start-white", "lichess-normal-move", "lichess-missed-moves-white"]],
    ["chess.com", ["chesscom-start-white", "chesscom-normal-move", "chesscom-missed-moves-white"]],
  ] as const) {
    const directory = path.join(root, "resources/stockfish");
    const engine = new Stockfish(path.join(directory, "stockfish"), directory);
    let localCalls = 0, cloudRecognitionCalls = 0, cloudExplanationCalls = 0, frameId = 0;
    const session = new Session({
      engine, settings: { ...DEFAULT_SETTINGS, automaticTracking: true, explanationsEnabled: false },
      // No key is loaded. The flag tests that a saved key cannot trigger cloud work in offline mode.
      hasApiKey: () => true, trackingQualified: () => false, trackingPreviewAvailable,
      emit: () => {}, capture: () => {},
      local: { recognize: (...args) => { localCalls++; return recognizer.recognize(...args); } },
      cloud: {
        recognize: async () => { cloudRecognitionCalls++; throw new Error("Unexpected cloud recognition"); },
        explain: async () => { cloudExplanationCalls++; throw new Error("Unexpected cloud explanation"); },
      },
    });
    const endpoints = [];
    try {
      session.select({ ...session.token(), sourceId: "window:1:0", crop: { x: 0, y: 0, width: 1, height: 1 },
        sourceWidth: 1024, sourceHeight: 1024, coachedSide: "w", orientation: "white-bottom" });
      const pair = (id: string, signature: number) => {
        const fixture = fixtures.find(f => f.id === id)!;
        const image = `data:image/jpeg;base64,${fs.readFileSync(path.join(root, "tests/fixtures", fixture.image)).toString("base64")}`;
        for (let i = 0; i < 2; i++) session.frame({ ...session.token(), frameId: ++frameId,
          image, signature: Array(4096).fill(signature), sourceWidth: 1024, sourceHeight: 1024 });
        return fixture;
      };
      const initial = pair(ids[0], 0);
      await waitFor(() => session.snapshot().status.state === "Needs correction");
      const observed = session.snapshot().observation;
      if (!observed || placementKey(observed.placements) !== placementKey(placementsOf(initial.expectedFen!)))
        throw new Error("Recorded initial local observation differs from expected placement");
      session.correct({ ...session.token(), format: "start", text: "", coachedSide: "w", orientation: "white-bottom", confirmed: true });
      await waitFor(() => session.snapshot().status.state === "Ready");
      if (!session.snapshot().running) throw new Error("Local preview did not start after applying the position");
      for (const [id, signature] of [[ids[1], 30], [ids[2], 60]] as const) {
        const started = performance.now(), fixture = pair(id, signature);
        await waitFor(() => session.snapshot().status.state === "Ready");
        const state = session.snapshot();
        if (state.position?.fen !== fixture.expectedFen || !state.analysis?.candidates.length || !state.running)
          throw new Error(`Recorded local move failed complete-state/engine validation: ${id}`);
        endpoints.push({ id, fen: state.position.fen, elapsedMs: performance.now() - started, engineMs: state.analysis.elapsedMs });
      }
      const calls = localCalls;
      pair(ids[2], 60);
      if (localCalls !== calls) throw new Error("Unchanged board requested recognition");
      session.rescan(); pair(ids[2], 60);
      await waitFor(() => session.snapshot().status.state === "Ready");
      session.pause(); pair(ids[2], 90);
      if (localCalls !== calls + 1 || session.snapshot().status.state !== "Paused") throw new Error("Pause did not stop local scanning");
      session.start(); pair(ids[2], 60);
      await waitFor(() => session.snapshot().status.state === "Ready");
      if (localCalls !== 5 || cloudRecognitionCalls || cloudExplanationCalls || !session.snapshot().running)
        throw new Error("Recorded local replay invoked cloud work or failed to resume");
      results.push({ site, passed: true, localCalls, cloudRecognitionCalls, cloudExplanationCalls,
        initialConfirmation: true, unchangedSuppressed: true, rescan: true, pause: true, resume: true, endpoints });
      console.log(JSON.stringify({ recordedSession: site, passed: true, localCalls, cloudRecognitionCalls, cloudExplanationCalls }));
    } finally { session.shutdown(); }
  }
  return { description: "Recorded JPEG replay through the real Session, Electron decoder and installed Stockfish. Samples are submitted directly; capture/stability wait, human initial confirmation and UI are excluded. This is not live capture qualification.", results };
}
