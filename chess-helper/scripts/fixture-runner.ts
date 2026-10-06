import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { importPosition, matchObservation, placementKey, placementsOf, sameToken } from "../src/core/position";
import type { BoardObservation, CapturedFrame, ConfirmedPosition, EngineAnalysis, Settings } from "../src/shared/contracts";
import type { Fixture } from "./fixture-schema";

export type FixtureResult = {
  id: string;
  outcome: "correct" | "correction" | "incorrect" | "error";
  reason: string;
  recognitionMatches: boolean | null;
  recognizedFen: string | null;
  latencyMs: number;
  recognitionMs: number;
  validationMs: number;
  engineMs: number | null;
};
type Dependencies = {
  recognize(frame: CapturedFrame, orientation: Fixture["orientation"], setting: Settings["recognition"], signal: AbortSignal): Promise<BoardObservation>;
  analyze(position: ConfirmedPosition, signal: AbortSignal): Promise<EngineAnalysis>;
};
export async function evaluate(fixture: Fixture, bytes: Buffer, setting: Settings["recognition"], deps: Dependencies): Promise<FixtureResult> {
  const started = performance.now();
  const token = { sessionId: randomUUID(), revision: 0 };
  const signal = new AbortController().signal;
  const result: FixtureResult = {
    id: fixture.id, outcome: "error", reason: "Recognition could not be validated",
    recognitionMatches: null, recognizedFen: null, latencyMs: 0,
    recognitionMs: 0, validationMs: 0, engineMs: null,
  };
  let recognitionDone = false;
  try {
    // CloudAI validates the strict vision payload before adding its tokens.
    const observation = await deps.recognize({
      ...token, frameId: 0,
      image: `data:image/${fixture.image.endsWith("png") ? "png" : "jpeg"};base64,${bytes.toString("base64")}`,
      signature: Array(4096).fill(0),
      sourceWidth: fixture.recording.pixelWidth,
      sourceHeight: fixture.recording.pixelHeight,
    }, fixture.orientation, setting, signal);
    result.recognitionMs = performance.now() - started;
    recognitionDone = true;
    const validationStart = performance.now();
    if (!sameToken(token, observation) || observation.frameId !== 0)
      throw new Error("Recognition returned a stale session or frame");
    result.recognitionMatches = fixture.expectedFen ?
      placementKey(observation.placements) === placementKey(placementsOf(fixture.expectedFen)) : null;
    let correction = !observation.boardVisible || !observation.cropAligned ||
      observation.uncertainSquares.length > 0 || observation.orientation !== fixture.orientation;
    let position: ConfirmedPosition | null = null;
    if (fixture.beforeFen) {
      const before = importPosition({ ...token, format: "fen", text: fixture.beforeFen, coachedSide: "w", orientation: fixture.orientation, confirmed: true }, 0);
      const matched = matchObservation(before, observation);
      correction ||= matched.kind === "correction";
      if (matched.kind === "correction") result.reason = matched.reason;
      else position = matched.kind === "move" ? matched.position : before;
      result.recognizedFen = correction ? null : position?.fen ?? null;
    }
    result.validationMs = performance.now() - validationStart;
    if (correction) {
      result.outcome = "correction";
      if (!fixture.beforeFen) result.reason = "Board visibility, orientation, or squares require correction";
    } else if (fixture.expectsCorrection || !result.recognitionMatches ||
      (position && fixture.expectedFen && position.fen !== new Chess(fixture.expectedFen).fen({ forceEnpassantSquare: true }))) {
      result.outcome = "incorrect";
      result.reason = "A known incorrect position was accepted without correction";
    } else {
      result.outcome = "correct";
      result.reason = position ? "Complete chess state matches ground truth" : "Placement matches; initial rights still require human confirmation";
      if (position) {
        const engineStarted = performance.now();
        const analysis = await deps.analyze(position, signal);
        result.engineMs = performance.now() - engineStarted;
        if (!sameToken(position, analysis)) throw new Error("Engine returned a stale position");
      }
    }
  } catch {
    // Never print API errors, request objects, keys, or image pixels.
    result.outcome = "error";
    result.reason = "Recognition or engine request failed validation; retry manually";
  } finally {
    result.latencyMs = performance.now() - started;
    if (!recognitionDone) result.recognitionMs = result.latencyMs;
  }
  return result;
}
