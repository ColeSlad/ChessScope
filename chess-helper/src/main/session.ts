import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import type {
  Snapshot,
  Token,
  CaptureSelection,
  CapturedFrame,
  Correction,
  Settings,
  CaptureCommand,
  ConfirmedPosition,
  EngineAnalysis,
  BoardObservation,
  MoveExplanation,
  PlayedMove,
} from "../shared/contracts";
import { sameToken, importPosition, matchObservation, moveUci, uciOf } from "../core/position";
import { StableFrames } from "../core/stability";
import { LatestTask } from "../core/latest-task";
import { cloudFailure } from "./cloud";

export interface SessionDependencies {
  engine: {
    analyze(
      position: ConfirmedPosition,
      signal: AbortSignal,
    ): Promise<EngineAnalysis>;
    restart(): Promise<void>;
    shutdown(): void;
  };
  cloud: {
    recognize(
      frame: CapturedFrame,
      orientation: CaptureSelection["orientation"],
      setting: Settings["recognition"],
      signal: AbortSignal,
    ): Promise<BoardObservation>;
    explain(
      position: ConfirmedPosition,
      analysis: EngineAnalysis,
      setting: Settings["explanations"],
      signal: AbortSignal,
    ): Promise<MoveExplanation[]>;
  };
  settings: Settings;
  hasApiKey: () => boolean;
  trackingQualified: (settings: Settings) => boolean;
  emit: (snapshot: Snapshot) => void;
  capture: (command: CaptureCommand) => void;
}
export class Session {
  private current: Snapshot;
  private stable = new StableFrames();
  private recognition: LatestTask<CapturedFrame>;
  private explanation: LatestTask<{
    position: ConfirmedPosition;
    analysis: EngineAnalysis;
  }>;
  private engineWork: LatestTask<ConfirmedPosition>;
  private lastFrame = -1;
  private manualSampling = false;
  constructor(private deps: SessionDependencies) {
    this.current = {
      status: {
        sessionId: randomUUID(),
        revision: 0,
        state: "Paused",
        message: "Select a board or enter a position to begin.",
      },
      position: null,
      analysis: null,
      explanations: [],
      explanationState: "idle",
      observation: null,
      selection: null,
      settings: deps.settings,
      hasApiKey: deps.hasApiKey(),
      trackingQualified: deps.trackingQualified(deps.settings),
      shortcutConflicts: [],
      running: false,
    };
    this.recognition = new LatestTask(async (frame, signal) => {
      try {
        const selection = this.current.selection;
        if (!selection || !this.isCurrent(frame)) return;
        const observation = await deps.cloud.recognize(
          frame,
          selection.orientation,
          this.current.settings.recognition,
          signal,
        );
        if (signal.aborted || !this.isCurrent(observation)) return;
        this.current.observation = observation;
        if (!this.current.position) {
          this.needsCorrection(
            "Confirm the recognized board and initialize its complete chess state.",
          );
          return;
        }
        const matched = matchObservation(this.current.position, observation);
        if (matched.kind === "correction") {
          this.needsCorrection(matched.reason);
          return;
        }
        if (matched.kind === "move")
          this.current.position = { ...matched.position, ...this.token() };
        if (matched.kind === "unchanged")
          this.current.position = { ...this.current.position, ...this.token() };
        this.manualSampling = false;
        if (!this.current.running) this.sendCapture("stop");
        this.analyze();
      } catch (error) {
        if (!signal.aborted && this.isCurrent(frame))
          this.fail(
            "recognition",
            deps.hasApiKey()
              ? cloudFailure(error)
              : "Add an API key in Settings to recognize the board.",
            "Rescan or correct the position.",
          );
      }
    });
    this.engineWork = new LatestTask(async (position, signal) => {
      try {
        const analysis = await deps.engine.analyze(position, signal);
        if (signal.aborted || !this.isCurrent(analysis)) return;
        this.current.analysis = analysis;
        const manual = !this.current.selection || !this.current.running;
        const recommendation =
          new Chess(position.fen).turn() === position.coachedSide
            ? "Engine recommendation ready."
            : "Opponent’s turn — these are expected opponent continuations.";
        this.setStatus(
          "Ready",
          analysis.terminal
            ? `${analysis.terminal === "checkmate" ? "Checkmate" : "Stalemate"}. No legal moves.`
            : `${recommendation}${manual ? " Update or rescan after each move." : ""}`,
        );
        if (analysis.candidates.length) this.requestExplanation();
      } catch {
        if (!signal.aborted && this.isCurrent(position))
          this.fail(
            "engine",
            "Stockfish is unavailable. Restart the engine and try again.",
            "Restart Engine",
          );
      }
    });
    this.explanation = new LatestTask(
      async ({ position, analysis }, signal) => {
        try {
          const explanations = await deps.cloud.explain(
            position,
            analysis,
            this.current.settings.explanations,
            signal,
          );
          if (
            signal.aborted ||
            !this.isCurrent(analysis) ||
            !explanations.every((entry) => this.isCurrent(entry))
          )
            return;
          this.current.explanations = explanations;
          this.current.explanationState = "ready";
          this.publish();
        } catch {
          if (!signal.aborted && this.isCurrent(analysis)) {
            this.current.explanationState = "unavailable";
            this.publish();
          }
        }
      },
    );
  }
  snapshot(): Snapshot {
    return structuredClone({
      ...this.current,
      hasApiKey: this.deps.hasApiKey(),
    });
  }
  token(): Token {
    return {
      sessionId: this.current.status.sessionId,
      revision: this.current.status.revision,
    };
  }
  isCurrent(token: Token) {
    return sameToken(token, this.current.status);
  }
  assertCurrent(token: Token) {
    if (!this.isCurrent(token))
      throw new Error("This action belongs to an older position. Try again.");
  }
  private publish() {
    this.deps.emit(this.snapshot());
  }
  private setStatus(state: Snapshot["status"]["state"], message: string) {
    this.current.status = { ...this.token(), state, message };
    this.publish();
  }
  private sendCapture(action: CaptureCommand["action"]) {
    this.deps.capture({
      ...this.token(),
      action,
      selection: this.current.selection,
    });
  }
  private invalidate(newSession = false) {
    this.recognition.cancel();
    this.explanation.cancel();
    this.engineWork.cancel();
    this.current.status = {
      ...this.current.status,
      sessionId: newSession ? randomUUID() : this.current.status.sessionId,
      revision: newSession ? 0 : this.current.status.revision + 1,
    };
    if (this.current.position)
      this.current.position = { ...this.current.position, ...this.token() };
    if (this.current.selection)
      this.current.selection = { ...this.current.selection, ...this.token() };
    this.current.analysis = null;
    this.current.explanations = [];
    this.current.explanationState = "idle";
  }
  private analyze() {
    const position = this.current.position;
    if (!position) return;
    this.setStatus(
      "Analyzing",
      "Stockfish is analyzing the confirmed position.",
    );
    this.engineWork.submit(structuredClone(position));
  }
  requestExplanation() {
    const { position, analysis } = this.current;
    if (!position || !analysis || !analysis.candidates.length) return;
    if (!this.deps.hasApiKey()) {
      this.current.explanationState = "unavailable";
      this.publish();
      return;
    }
    this.current.explanationState = "loading";
    this.publish();
    this.explanation.submit({
      position: structuredClone(position),
      analysis: structuredClone(analysis),
    });
  }
  select(selection: CaptureSelection) {
    this.assertCurrent(selection);
    this.sendCapture("stop");
    this.invalidate(true);
    this.current.selection = { ...selection, ...this.token() };
    this.current.position = null;
    this.current.observation = null;
    this.current.running = false;
    this.lastFrame = -1;
    this.stable.reset();
    this.manualSampling = true;
    this.setStatus(
      "Reading board",
      "Reading the board. You will confirm the full position before analysis.",
    );
    this.sendCapture("sample");
  }
  sourceChanged() {
    this.sendCapture("stop");
    this.invalidate(true);
    this.current.selection = null;
    this.current.position = null;
    this.current.observation = null;
    this.current.running = false;
    this.manualSampling = false;
    this.stable.reset();
    this.lastFrame = -1;
    this.setStatus(
      "Paused",
      "Mark the board rectangle in the selected browser window.",
    );
  }
  correct(correction: Correction) {
    this.assertCurrent(correction);
    const next = importPosition(correction, this.current.status.revision + 1);
    // Explicit human correction is authoritative; uncertain or misread squares may be repaired.
    // A moved/hidden crop still needs to be selected and recognized again.
    const observation = this.current.observation;
    if (
      this.current.selection &&
      observation &&
      (!observation.boardVisible || !observation.cropAligned)
    )
      throw new Error(
        "Select and read the visible board before confirming the position.",
      );
    this.invalidate();
    this.current.position = next;
    if (this.current.selection)
      this.current.selection.orientation = correction.orientation;
    this.current.running = false;
    this.manualSampling = false;
    this.sendCapture("stop");
    this.analyze();
  }
  start() {
    if (!this.current.position) {
      this.needsCorrection(
        "Confirm a starting position or enter FEN/PGN before starting.",
      );
      return;
    }
    this.invalidate();
    this.stable.reset();
    this.lastFrame = -1;
    if (
      !this.current.selection ||
      !this.current.settings.automaticTracking ||
      !this.current.trackingQualified
    ) {
      this.current.running = false;
      this.manualSampling = false;
      this.sendCapture("stop");
      this.analyze();
      return;
    }
    this.current.running = true;
    this.manualSampling = false;
    this.setStatus("Reading board", "Waiting for two stable board samples.");
    this.sendCapture("start");
  }
  recordMove(value: PlayedMove) {
    this.assertCurrent(value);
    const position = this.current.position;
    if (!position || this.current.status.state === "Needs correction")
      throw new Error("Confirm or correct the complete position before recording a move.");
    const chess = new Chess(position.fen);
    const notation = value.move.trim().replace(/^0-0(-0)?([+#]?)$/, (_all, queenside, suffix) => `O-O${queenside ? "-O" : ""}${suffix}`);
    let move;
    try {
      move = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(notation)
        ? moveUci(chess, notation)
        : chess.move(notation, { strict: true });
    } catch {
      throw new Error("That move is not legal in the confirmed position. Use SAN (e4, Nf3, O-O) or UCI (e2e4); correct the position if moves were missed.");
    }
    this.invalidate();
    this.current.position = {
      ...position, ...this.token(),
      fen: chess.fen({ forceEnpassantSquare: true }),
      moves: [...position.moves, uciOf(move)],
    };
    this.current.observation = null;
    this.current.running = false;
    this.manualSampling = false;
    this.stable.reset();
    this.lastFrame = -1;
    this.sendCapture("stop");
    this.analyze();
  }
  pause() {
    this.invalidate();
    this.current.running = false;
    this.manualSampling = false;
    this.sendCapture("stop");
    this.stable.reset();
    this.setStatus("Paused", "Tracking and analysis paused.");
  }
  rescan() {
    if (!this.current.selection) {
      if (!this.current.position) {
        this.needsCorrection(
          "Select a board or enter a position before rescanning.",
        );
        return;
      }
      this.invalidate();
      this.analyze();
      return;
    }
    this.invalidate();
    this.stable.reset();
    this.lastFrame = -1;
    this.manualSampling = true;
    this.setStatus(
      "Reading board",
      "Waiting for two stable samples before recognition.",
    );
    this.sendCapture("sample");
  }
  frame(frame: CapturedFrame) {
    if (
      !this.isCurrent(frame) ||
      (!this.current.running && !this.manualSampling) ||
      !this.current.selection ||
      frame.frameId <= this.lastFrame
    )
      return;
    this.lastFrame = frame.frameId;
    const selection = this.current.selection;
    if (
      frame.sourceWidth !== selection.sourceWidth ||
      frame.sourceHeight !== selection.sourceHeight
    ) {
      this.needsCorrection(
        "The browser window resized. Select Board again to confirm the crop.",
      );
      return;
    }
    const decision = this.stable.ingest(frame.signature);
    if (decision.changed) {
      this.invalidate();
      this.setStatus(
        "Reading board",
        "The board changed. Waiting for a stable position.",
      );
      this.sendCapture(this.current.running ? "start" : "sample");
    }
    if (decision.ready) {
      const currentFrame = { ...frame, ...this.token() };
      this.setStatus("Reading board", "Recognizing the cropped board.");
      this.recognition.submit(currentFrame);
    }
  }
  needsCorrection(message: string) {
    this.invalidate();
    this.current.running = false;
    this.manualSampling = false;
    this.sendCapture("stop");
    this.setStatus("Needs correction", message);
  }
  fail(
    code: "capture" | "recognition" | "engine",
    message: string,
    action: string,
  ) {
    this.invalidate();
    this.current.running = false;
    this.manualSampling = false;
    this.sendCapture("stop");
    this.current.status = {
      ...this.token(),
      state: code === "capture" ? "Paused" : "Needs correction",
      message,
      error: { code, action },
    };
    this.publish();
  }
  settings(settings: Settings, conflicts: string[]) {
    this.pause();
    this.current.settings = settings;
    this.current.trackingQualified = this.deps.trackingQualified(settings);
    this.current.shortcutConflicts = conflicts;
    this.publish();
  }
  conflicts(conflicts: string[]) {
    this.current.shortcutConflicts = conflicts;
    this.publish();
  }
  async restartEngine() {
    this.pause();
    this.setStatus("Analyzing", "Restarting Stockfish.");
    const token = this.token();
    try {
      await this.deps.engine.restart();
      if (!this.isCurrent(token)) return;
      if (this.current.position) this.analyze();
      else
        this.setStatus(
          "Paused",
          "Stockfish restarted. Select a board or enter a position.",
        );
    } catch {
      if (this.isCurrent(token))
        this.fail(
          "engine",
          "Stockfish could not restart. Verify the bundled engine.",
          "Restart Engine",
        );
    }
  }
  shutdown() {
    this.pause();
    this.deps.engine.shutdown();
  }
}
