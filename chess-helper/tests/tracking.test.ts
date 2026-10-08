import { Chess, DEFAULT_POSITION } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import { Session, type SessionDependencies } from "../src/main/session";
import { legalCandidate, placementsOf, uciOf } from "../src/core/position";
import { DEFAULT_SETTINGS, type CapturedFrame, type ConfirmedPosition, type EngineAnalysis, type MoveExplanation } from "../src/shared/contracts";
import { solTrackingPreviewAvailable } from "../src/core/tracking-policy";

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function analysis(position: ConfirmedPosition): EngineAnalysis {
  const chess = new Chess(position.fen);
  const move = chess.moves({ verbose: true })[0];
  if (!move) return { ...position, candidates: [], elapsedMs: 1000, terminal: chess.isCheckmate() ? "checkmate" : "stalemate" };
  chess.move(move);
  const reply = chess.moves({ verbose: true })[0];
  return {
    ...position, elapsedMs: 1000, terminal: null,
    candidates: [legalCandidate(position.fen, uciOf(move), { type: "cp", value: 20 }, 12, [uciOf(move), ...(reply ? [uciOf(reply)] : [])])],
  };
}
function harness(qualified = true, preview = false, automaticTracking = true) {
  let observedFen = DEFAULT_POSITION;
  const capture = vi.fn();
  const recognize = vi.fn(async (frame: CapturedFrame) => ({
    sessionId: frame.sessionId, revision: frame.revision, frameId: frame.frameId,
    placements: placementsOf(observedFen), orientation: "white-bottom" as const,
    uncertainSquares: [], boardVisible: true, cropAligned: true,
  }));
  const deps: SessionDependencies = {
    settings: { ...structuredClone(DEFAULT_SETTINGS), automaticTracking },
    hasApiKey: () => true, trackingQualified: () => qualified,
    trackingPreviewAvailable: (settings) => preview && solTrackingPreviewAvailable(settings),
    emit: vi.fn(), capture,
    engine: { analyze: vi.fn(async (p) => analysis(p)), restart: vi.fn(async () => {}), shutdown: vi.fn() },
    cloud: { recognize, explain: vi.fn(async (p: ConfirmedPosition, a: EngineAnalysis) => a.candidates.map(c => ({ ...p, candidateId: c.id, explanation: "Center control.", benefit: "Space.", drawback: "A target.", reply: c.variation[1]?.uci ?? null }))) },
  };
  const session = new Session(deps);
  session.select({ ...session.token(), sourceId: "window:123:0", crop: { x: 0, y: 0, width: 0.5, height: 0.5 }, orientation: "white-bottom", coachedSide: "w", sourceWidth: 1000, sourceHeight: 1000 });
  session.correct({ ...session.token(), format: "start", text: "", coachedSide: "w", orientation: "white-bottom", confirmed: true });
  let id = 0;
  const sample = (value = 0) => session.frame({ ...session.token(), frameId: ++id, image: "data:image/jpeg;base64,AAAA", signature: Array(4096).fill(value), sourceWidth: 1000, sourceHeight: 1000 });
  return { session, deps, capture, recognize, sample, observe: (fen: string) => { observedFen = fen; } };
}

describe("continuous tracking after fixture qualification", () => {
  it("keeps sampling after confirmation, our move, the opponent reply, and Rescan", async () => {
    const h = harness();
    await flush();
    expect(h.session.snapshot().running).toBe(true);
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "start" }));
    h.sample(); h.sample(); await flush();
    const chess = new Chess();
    for (const [move, signature] of [["e4", 30], ["e5", 60], ["Nf3", 90]] as const) {
      chess.move(move); h.observe(chess.fen({ forceEnpassantSquare: true }));
      h.sample(signature);
      expect(h.session.snapshot().analysis).toBeNull();
      expect(h.session.snapshot().explanations).toEqual([]);
      h.sample(signature); await flush();
      const state = h.session.snapshot();
      expect(state.running).toBe(true);
      expect(state.position?.fen).toBe(chess.fen({ forceEnpassantSquare: true }));
      expect(state.analysis?.revision).toBe(state.position?.revision);
      expect(state.status.state).toBe("Ready");
      if (chess.turn() === "b") expect(state.status.message).toContain("Opponent’s turn");
    }
    expect(h.session.snapshot().position?.moves).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(h.recognize).toHaveBeenCalledTimes(4);
    h.sample(90); h.sample(90); await flush();
    expect(h.recognize).toHaveBeenCalledTimes(4);
    h.session.rescan();
    expect(h.session.snapshot().running).toBe(true);
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "start" }));
    h.sample(90); h.sample(90); await flush();
    expect(h.recognize).toHaveBeenCalledTimes(5);
    h.session.pause();
    h.sample(120); h.sample(120); await flush();
    expect(h.recognize).toHaveBeenCalledTimes(5);
    expect(h.session.snapshot().analysis).toBeNull();
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "stop" }));
  });

  it("continues tracking after a locally recorded move and never applies it twice", async () => {
    const h = harness(); await flush();
    h.session.recordMove({ ...h.session.token(), move: "e4" });
    const chess = new Chess(); chess.move("e4"); h.observe(chess.fen({ forceEnpassantSquare: true }));
    expect(h.session.snapshot().running).toBe(true);
    h.sample(30); h.sample(30); await flush();
    expect(h.session.snapshot().position?.moves).toEqual(["e2e4"]);
    chess.move("e5"); h.observe(chess.fen({ forceEnpassantSquare: true }));
    h.sample(60); h.sample(60); await flush();
    expect(h.session.snapshot().position?.moves).toEqual(["e2e4", "e7e5"]);
    expect(h.session.snapshot().running).toBe(true);
  });

  it.each([
    ["qualified", true, false], ["preview", false, true],
  ] as const)("stops %s tracking and requests correction if multiple moves were missed", async (_mode, qualified, preview) => {
    const h = harness(qualified, preview); await flush();
    h.sample(); h.sample(); await flush();
    const chess = new Chess(); chess.move("e4"); chess.move("e5"); h.observe(chess.fen());
    h.sample(60); h.sample(60); await flush();
    expect(h.session.snapshot().status.state).toBe("Needs correction");
    expect(h.session.snapshot().running).toBe(false);
    expect(h.session.snapshot().analysis).toBeNull();
    expect(h.session.snapshot().position?.fen).toBe(DEFAULT_POSITION);
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "stop" }));
  });

  it("discards an old explanation when the board changes while it is pending", async () => {
    const h = harness(); await flush(); h.sample(); h.sample(); await flush();
    let resolve!: (value: MoveExplanation[]) => void;
    let previous!: ConfirmedPosition;
    h.deps.cloud.explain = vi.fn((p: ConfirmedPosition) => { previous = p; return new Promise<MoveExplanation[]>(r => { resolve = r; }); });
    h.session.requestExplanation(); await flush();
    h.sample(30);
    resolve([{ ...previous, candidateId: "e2e4", explanation: "Old", benefit: "Old", drawback: "Old", reply: "e7e5" }]);
    await flush();
    expect(h.session.snapshot().explanations).toEqual([]);
    expect(h.session.snapshot().analysis).toBeNull();
    expect(h.session.snapshot().status.state).toBe("Reading board");
  });

  it("does not start automatic capture before fixture qualification even if the preference is enabled", async () => {
    const h = harness(false); await flush();
    expect(h.session.snapshot().running).toBe(false);
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "stop" }));
    h.sample(); h.sample(); await flush();
    expect(h.recognize).not.toHaveBeenCalled();
    expect(h.session.snapshot().analysis).not.toBeNull();
  });

  it("requires opt-in for the unqualified Sol/Low preview, then follows both players and supports pause/resume", async () => {
    const h = harness(false, true, false); await flush();
    expect(h.session.snapshot().trackingQualified).toBe(false);
    expect(h.session.snapshot().trackingPreviewAvailable).toBe(true);
    expect(h.session.snapshot().running).toBe(false);
    h.sample(); h.sample(); await flush();
    expect(h.recognize).not.toHaveBeenCalled();

    h.session.settings({ ...h.session.snapshot().settings, automaticTracking: true }, []);
    h.session.start();
    expect(h.session.snapshot().running).toBe(true);
    const chess = new Chess();
    for (const [move, signature] of [["e4", 30], ["e5", 60]] as const) {
      chess.move(move); h.observe(chess.fen({ forceEnpassantSquare: true }));
      h.sample(signature); h.sample(signature); await flush();
      expect(h.session.snapshot().position?.fen).toBe(chess.fen({ forceEnpassantSquare: true }));
      expect(h.session.snapshot().running).toBe(true);
      expect(h.session.snapshot().trackingQualified).toBe(false);
    }
    h.session.rescan();
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "start" }));
    h.sample(60); h.sample(60); await flush();
    h.session.pause();
    expect(h.session.snapshot().running).toBe(false);
    const requests = h.recognize.mock.calls.length;
    h.sample(90); h.sample(90); await flush();
    expect(h.recognize).toHaveBeenCalledTimes(requests);
    h.session.start();
    expect(h.session.snapshot().running).toBe(true);
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "start" }));
  });

  it.each([
    ["gpt-6-astra", "low"], ["gpt-6-astra", "medium"],
    ["gpt-6-astra", "high"], ["gpt-6-astra", "xhigh"],
    ["gpt-6.1-sol", "medium"], ["gpt-6.1-sol", "high"],
    ["gpt-6.1-sol", "xhigh"],
  ] as const)("stops preview capture after switching recognition to %s/%s", async (model, effort) => {
    const h = harness(false, true); await flush();
    expect(h.session.snapshot().running).toBe(true);
    h.session.settings({ ...h.session.snapshot().settings, recognition: { model, effort } }, []);
    expect(h.session.snapshot().trackingPreviewAvailable).toBe(false);
    expect(h.session.snapshot().trackingQualified).toBe(false);
    expect(h.session.snapshot().running).toBe(false);
    h.session.start();
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ action: "stop" }));
    h.sample(); h.sample(); await flush();
    expect(h.recognize).not.toHaveBeenCalled();
    expect(h.session.snapshot().analysis).not.toBeNull();
  });
});
