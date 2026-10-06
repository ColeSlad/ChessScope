import { Chess, DEFAULT_POSITION } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import { evaluate } from "../scripts/fixture-runner";
import { fixtureManifestSchema, fixtureSchema, missingCoverage, type Fixture } from "../scripts/fixture-schema";
import { placementsOf } from "../src/core/position";
import { DEFAULT_SETTINGS, type BoardObservation, type CapturedFrame, type ConfirmedPosition } from "../src/shared/contracts";

const fixture = (beforeFen: string | null, expectedFen: string | null, expectsCorrection = false): Fixture => ({
  id: "lichess-test", site: "lichess", tags: ["white-bottom", "default-2d"],
  image: "lichess-test.png", sha256: "a".repeat(64), orientation: "white-bottom",
  beforeFen, expectedFen, expectsCorrection,
  recording: { recordedAt: "2026-10-06T12:00:00Z", url: "https://lichess.org/analysis", theme: "default-2d", pixelWidth: 1024, pixelHeight: 1024, scaleFactor: 2, notes: "Unit test metadata; never a recorded site fixture." },
});
function dependencies(fen: string, overrides: Partial<BoardObservation> = {}) {
  return {
    recognize: vi.fn(async (frame: CapturedFrame) => ({
      sessionId: frame.sessionId, revision: frame.revision, frameId: frame.frameId,
      placements: placementsOf(fen), orientation: "white-bottom" as const,
      uncertainSquares: [], boardVisible: true, cropAligned: true, ...overrides,
    })),
    analyze: vi.fn(async (p: ConfirmedPosition) => ({ ...p, candidates: [], terminal: null, elapsedMs: 1000 })),
  };
}
const bytes = Buffer.from("unit-test-image-only");
describe("recorded-fixture evaluator", () => {
  it.each([
    [DEFAULT_POSITION, "e4"],
    ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "O-O"],
    ["4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2", "exd6"],
    ["4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a8=Q+"],
    ["4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "exd5"],
  ])("accepts a legal transition with complete turn, rights, en passant, and clocks (%s, %s)", async (before, move) => {
    const chess = new Chess(before); chess.move(move);
    const after = chess.fen({ forceEnpassantSquare: true });
    const deps = dependencies(after);
    const result = await evaluate(fixture(before, after), bytes, DEFAULT_SETTINGS.recognition, deps);
    expect(result.outcome).toBe("correct");
    expect(result.recognizedFen).toBe(after);
    expect(result.engineMs).not.toBeNull();
    expect(deps.analyze).toHaveBeenCalledTimes(1);
  });
  it("allows token-bearing vision output without re-parsing it as a strict, token-free schema", async () => {
    const deps = dependencies(DEFAULT_POSITION);
    const result = await evaluate(fixture(null, DEFAULT_POSITION), bytes, DEFAULT_SETTINGS.recognition, deps);
    expect(result.outcome).toBe("correct");
    expect(result.reason).toContain("human confirmation");
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("fails a wrong full FEN even when every piece is recognized correctly", async () => {
    const chess = new Chess(); chess.move("e4");
    const after = chess.fen({ forceEnpassantSquare: true });
    const wrong = after.replace(" b ", " w ");
    const result = await evaluate(fixture(DEFAULT_POSITION, wrong), bytes, DEFAULT_SETTINGS.recognition, dependencies(after));
    expect(result.recognitionMatches).toBe(true);
    expect(result.outcome).toBe("incorrect");
  });
  it("never silently accepts a different legal move than ground truth", async () => {
    const actual = new Chess(); actual.move("e4");
    const mistaken = new Chess(); mistaken.move("d4");
    const deps = dependencies(mistaken.fen());
    const result = await evaluate(fixture(DEFAULT_POSITION, actual.fen({ forceEnpassantSquare: true })), bytes, DEFAULT_SETTINGS.recognition, deps);
    expect(result.outcome).toBe("incorrect");
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it.each([
    { uncertainSquares: ["e4"] }, { boardVisible: false }, { cropAligned: false }, { orientation: "black-bottom" as const },
  ])("reports explicit correction instead of incorrect acceptance (%j)", async (flags) => {
    const deps = dependencies(DEFAULT_POSITION, flags);
    const result = await evaluate(fixture(DEFAULT_POSITION, DEFAULT_POSITION), bytes, DEFAULT_SETTINGS.recognition, deps);
    expect(result.outcome).toBe("correction");
    expect(result.recognizedFen).toBeNull();
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("requires correction when two moves were missed", async () => {
    const chess = new Chess(); chess.move("e4"); chess.move("e5");
    const result = await evaluate(fixture(DEFAULT_POSITION, chess.fen(), true), bytes, DEFAULT_SETTINGS.recognition, dependencies(chess.fen()));
    expect(result.outcome).toBe("correction");
  });
  it("counts acceptance of a deliberately ambiguous image as incorrect", async () => {
    const result = await evaluate(fixture(DEFAULT_POSITION, DEFAULT_POSITION, true), bytes, DEFAULT_SETTINGS.recognition, dependencies(DEFAULT_POSITION));
    expect(result.outcome).toBe("incorrect");
  });
  it("discards stale recognition and sanitizes API failures while retaining timing", async () => {
    const stale = await evaluate(fixture(null, DEFAULT_POSITION), bytes, DEFAULT_SETTINGS.recognition, dependencies(DEFAULT_POSITION, { revision: 99 }));
    expect(stale.outcome).toBe("error");
    const deps = dependencies(DEFAULT_POSITION);
    deps.recognize.mockRejectedValue(new Error("secret-key-and-request-image"));
    const failed = await evaluate(fixture(null, DEFAULT_POSITION), bytes, DEFAULT_SETTINGS.recognition, deps);
    expect(failed.outcome).toBe("error");
    expect(failed.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(failed)).not.toContain("secret-key-and-request-image");
  });
  it("discards an engine analysis with a stale token", async () => {
    const deps = dependencies(DEFAULT_POSITION);
    deps.analyze.mockImplementation(async p => ({ ...p, revision: p.revision + 1, candidates: [], terminal: null, elapsedMs: 1000 }));
    const result = await evaluate(fixture(DEFAULT_POSITION, DEFAULT_POSITION), bytes, DEFAULT_SETTINGS.recognition, deps);
    expect(result.outcome).toBe("error");
  });
});
describe("fixture provenance and coverage", () => {
  it("requires both websites and explicit default-theme coverage", () => {
    expect(missingCoverage([])).toHaveLength(34);
    const missing = missingCoverage([fixture(null, DEFAULT_POSITION)]);
    expect(missing).toContainEqual({ site: "chess.com", tag: "default-2d" });
    expect(missing).not.toContainEqual({ site: "lichess", tag: "default-2d" });
  });
  it("rejects invalid FEN, site attribution, orientation, Retina claims, and unsafe paths", () => {
    const item = fixture(null, DEFAULT_POSITION);
    for (const invalid of [
      { expectedFen: "8/8/8/8/8/8/8/8 w - - 0 1" },
      { recording: { ...item.recording, url: "https://example.org" } },
      { orientation: "black-bottom" },
      { image: "../../private.png" },
      { tags: ["white-bottom", "retina"], recording: { ...item.recording, scaleFactor: 1 } },
    ]) expect(fixtureSchema.safeParse({ ...item, ...invalid }).success).toBe(false);
  });
  it("rejects duplicate recordings even with different identifiers", () => {
    const item = fixture(null, DEFAULT_POSITION);
    expect(fixtureManifestSchema.safeParse({ version: 2, description: "Tests", cases: [item, { ...item, id: "second" }] }).success).toBe(false);
  });
  it("rejects coverage labels unsupported by the ground-truth move or terminal position", () => {
    const chess = new Chess(); chess.move("e4");
    const item = fixture(DEFAULT_POSITION, chess.fen({ forceEnpassantSquare: true }));
    expect(fixtureSchema.safeParse({ ...item, tags: ["white-bottom", "move"] }).success).toBe(true);
    for (const tag of ["castling", "en-passant", "promotion", "capture", "checkmate", "stalemate", "ambiguous", "missed-moves"])
      expect(fixtureSchema.safeParse({ ...item, tags: ["white-bottom", tag] }).success).toBe(false);
  });
});
