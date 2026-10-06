import { describe, it, expect, vi } from "vitest";
import { DEFAULT_POSITION } from "chess.js";
import { Session, type SessionDependencies } from "../src/main/session";
import {
  DEFAULT_SETTINGS,
  type EngineAnalysis,
  type ConfirmedPosition,
  type MoveExplanation,
  type CapturedFrame,
  type BoardObservation,
} from "../src/shared/contracts";
import { legalCandidate, placementsOf } from "../src/core/position";
import { sessionIsActive } from "../src/core/session-controls";
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const analysis = (position: ConfirmedPosition): EngineAnalysis => ({
  ...position,
  candidates: [
    legalCandidate(position.fen, "e2e4", { type: "cp", value: 30 }, 15, [
      "e2e4",
      "e7e5",
    ]),
  ],
  elapsedMs: 1000,
  terminal: null,
});
function make(overrides: Partial<SessionDependencies> = {}) {
  const deps: SessionDependencies = {
    settings: structuredClone(DEFAULT_SETTINGS),
    hasApiKey: () => true,
    trackingQualified: () => true,
    emit: vi.fn(),
    capture: vi.fn(),
    engine: {
      analyze: vi.fn(async (p) => analysis(p)),
      restart: vi.fn(async () => {}),
      shutdown: vi.fn(),
    },
    cloud: {
      recognize: vi.fn(async (frame) => ({
        ...frame,
        placements: placementsOf(DEFAULT_POSITION),
        orientation: "white-bottom",
        uncertainSquares: [],
        boardVisible: true,
        cropAligned: true,
      })),
      explain: vi.fn(async (p: ConfirmedPosition, a: EngineAnalysis) =>
        a.candidates.map((c) => ({
          ...p,
          candidateId: c.id,
          explanation: "The center.",
          benefit: "Space.",
          drawback: "A target.",
          reply: "e7e5",
        })),
      ),
    },
    ...overrides,
  };
  return { session: new Session(deps), deps };
}
function setup(session: Session) {
  session.correct({
    ...session.token(),
    format: "start",
    text: "",
    coachedSide: "w",
    orientation: "white-bottom",
    confirmed: true,
  });
}
function select(session: Session) {
  session.select({
    ...session.token(),
    sourceId: "window:123:0",
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    orientation: "white-bottom",
    coachedSide: "w",
    sourceWidth: 1000,
    sourceHeight: 1000,
  });
}
function frame(session: Session, id: number, value = 0): CapturedFrame {
  return {
    ...session.token(),
    frameId: id,
    image: "data:image/jpeg;base64,AAAA",
    signature: Array(4096).fill(value),
    sourceWidth: 1000,
    sourceHeight: 1000,
  };
}
describe("revision-safe sessions", () => {
  it("analyzes a manually confirmed starting board without waiting for cloud recognition", async () => {
    let resolve!: (observation: BoardObservation) => void;
    const { session, deps } = make();
    deps.cloud.recognize = vi.fn(() => new Promise<BoardObservation>((r) => { resolve = r; }));
    select(session);
    session.frame(frame(session, 1));
    const pending = frame(session, 2);
    session.frame(pending);
    expect(sessionIsActive(session.snapshot())).toBe(true);
    setup(session);
    await flush();
    expect(session.snapshot().position?.fen).toBe(DEFAULT_POSITION);
    expect(session.snapshot().status.state).toBe("Ready");
    expect(deps.engine.analyze).toHaveBeenCalledTimes(1);
    resolve({ ...pending, placements: [], orientation: "white-bottom", uncertainSquares: [], boardVisible: false, cropAligned: false });
    await flush();
    expect(session.snapshot().status.state).toBe("Ready");
    expect(session.snapshot().observation).toBeNull();
  });
  it.each([false, true])("analyzes the confirmed position without rescanning when automatic tracking is unqualified (setting %s)", async (automaticTracking) => {
    const { session, deps } = make({
      settings: { ...DEFAULT_SETTINGS, automaticTracking },
      trackingQualified: () => false,
    });
    select(session);
    setup(session);
    await flush();
    session.pause();
    vi.mocked(deps.capture).mockClear();
    session.start();
    expect(sessionIsActive(session.snapshot())).toBe(true);
    await flush();
    expect(session.snapshot().status.state).toBe("Ready");
    expect(session.snapshot().running).toBe(false);
    expect(deps.capture).toHaveBeenCalledWith(expect.objectContaining({ action: "stop" }));
    expect(deps.capture).not.toHaveBeenCalledWith(expect.objectContaining({ action: "sample" }));
    expect(deps.cloud.recognize).not.toHaveBeenCalled();
  });
  it("still requires a new crop after vision explicitly reports hidden or misaligned capture", async () => {
    const { session, deps } = make();
    deps.cloud.recognize = vi.fn(async (frame) => ({
      ...frame, placements: [], orientation: "white-bottom", uncertainSquares: [], boardVisible: false, cropAligned: false,
    }));
    select(session);
    session.frame(frame(session, 1));
    session.frame(frame(session, 2));
    await flush();
    expect(() => setup(session)).toThrow("Select and read the visible board");
    expect(deps.engine.analyze).not.toHaveBeenCalled();
  });
  it("publishes an actionable status and current revision when rescanning without a position", () => {
    const { session, deps } = make();
    const previous = session.token();
    session.rescan();
    expect(session.snapshot().status.state).toBe("Needs correction");
    expect(session.token().revision).toBe(previous.revision + 1);
    expect(deps.emit).toHaveBeenLastCalledWith(session.snapshot());
    expect(deps.engine.analyze).not.toHaveBeenCalled();
  });
  it("discards engine completion after pause even if engine ignores abort", async () => {
    let resolve!: (a: EngineAnalysis) => void;
    let pending!: ConfirmedPosition;
    const { session } = make({
      engine: {
        analyze: async (p) => {
          pending = p;
          return new Promise((r) => (resolve = r));
        },
        restart: async () => {},
        shutdown: () => {},
      },
    });
    setup(session);
    await flush();
    session.pause();
    resolve(analysis(pending));
    await flush();
    expect(session.snapshot().analysis).toBeNull();
    expect(session.snapshot().status.state).toBe("Paused");
  });
  it("discards late explanation after correction", async () => {
    let resolve!: (a: MoveExplanation[]) => void;
    let old!: ConfirmedPosition;
    const { session } = make({
      cloud: {
        recognize: vi.fn(),
        explain: async (p) => {
          old = p;
          return new Promise((r) => (resolve = r));
        },
      },
    });
    setup(session);
    await flush();
    expect(session.snapshot().analysis).not.toBeNull();
    session.pause();
    resolve([
      {
        ...old,
        candidateId: "e2e4",
        explanation: "stale",
        benefit: "",
        drawback: "",
        reply: "e7e5",
      },
    ]);
    await flush();
    expect(session.snapshot().explanations).toEqual([]);
  });
  it("keeps valid engine candidates after explanation failure", async () => {
    const { session } = make({
      cloud: {
        recognize: vi.fn(),
        explain: async () => {
          throw new Error("API failure");
        },
      },
    });
    setup(session);
    await flush();
    expect(session.snapshot().analysis?.candidates).toHaveLength(1);
    expect(session.snapshot().explanationState).toBe("unavailable");
  });
  it("does not recognize or analyze after pause", async () => {
    const { session, deps } = make();
    select(session);
    session.pause();
    session.frame(frame(session, 1));
    session.frame(frame(session, 2));
    await flush();
    expect(deps.cloud.recognize).not.toHaveBeenCalled();
    expect(deps.engine.analyze).not.toHaveBeenCalled();
  });
  it("requires two stable samples and does not resend unchanged boards", async () => {
    const { session, deps } = make();
    select(session);
    session.frame(frame(session, 1));
    expect(deps.cloud.recognize).not.toHaveBeenCalled();
    session.frame(frame(session, 2));
    await flush();
    expect(deps.cloud.recognize).toHaveBeenCalledTimes(1);
    expect(session.snapshot().status.state).toBe("Needs correction");
  });
  it("clears recommendations as soon as a board change is observed", async () => {
    const { session } = make();
    select(session);
    session.frame(frame(session, 1));
    session.frame(frame(session, 2));
    await flush();
    setup(session);
    await flush();
    expect(session.snapshot().analysis).not.toBeNull();
    session.rescan();
    session.frame(frame(session, 3));
    session.frame(frame(session, 4));
    await flush();
    expect(session.snapshot().analysis).not.toBeNull();
    const settings = { ...DEFAULT_SETTINGS, automaticTracking: true };
    session.settings(settings, []);
    session.start();
    session.frame(frame(session, 5));
    session.frame(frame(session, 6));
    await flush();
    expect(session.snapshot().analysis).not.toBeNull();
    session.frame(frame(session, 7, 50));
    expect(session.snapshot().analysis).toBeNull();
    expect(session.snapshot().status.state).toBe("Reading board");
  });
  it("rejects stale correction and clears state on source changes", () => {
    const { session } = make();
    const token = session.token();
    session.sourceChanged();
    expect(() =>
      session.correct({
        ...token,
        format: "start",
        text: "",
        coachedSide: "w",
        orientation: "white-bottom",
        confirmed: true,
      }),
    ).toThrow();
    expect(session.snapshot().position).toBeNull();
  });
  it("requests correction after resize and engine failure is recoverable", () => {
    const { session } = make();
    select(session);
    session.frame({ ...frame(session, 1), sourceWidth: 1100 });
    expect(session.snapshot().status.state).toBe("Needs correction");
    session.fail("engine", "Restart engine", "Restart");
    expect(session.snapshot().analysis).toBeNull();
    expect(session.snapshot().status.error?.action).toBe("Restart");
  });
});

it("clears results on engine restart and discards explanations from its previous search", async () => {
  let releaseRestart!: () => void;
  let resolveExplanation!: (value: MoveExplanation[]) => void;
  let previous!: ConfirmedPosition;
  const { session } = make({
    engine: {
      analyze: async (p) => analysis(p),
      restart: () =>
        new Promise<void>((resolve) => {
          releaseRestart = resolve;
        }),
      shutdown: () => {},
    },
    cloud: {
      recognize: vi.fn(),
      explain: async (p) => {
        previous = p;
        return new Promise((resolve) => {
          resolveExplanation = resolve;
        });
      },
    },
  });
  setup(session);
  await flush();
  const revision = session.token().revision;
  expect(session.snapshot().analysis).not.toBeNull();
  const restarting = session.restartEngine();
  expect(session.snapshot().analysis).toBeNull();
  expect(session.token().revision).toBe(revision + 1);
  resolveExplanation([
    {
      ...previous,
      candidateId: "e2e4",
      explanation: "Previous search",
      reply: "e7e5",
      benefit: "Space",
      drawback: "Target",
    },
  ]);
  await flush();
  expect(session.snapshot().explanations).toEqual([]);
  releaseRestart();
  await restarting;
  await flush();
  expect(session.snapshot().analysis?.revision).toBe(revision + 1);
  expect(session.snapshot().explanations).toEqual([]);
});
