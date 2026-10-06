import { z } from "zod";

export const sideSchema = z.enum(["w", "b"]);
export const squareSchema = z.string().regex(/^[a-h][1-8]$/);
export const pieceSchema = z.enum([
  "P",
  "N",
  "B",
  "R",
  "Q",
  "K",
  "p",
  "n",
  "b",
  "r",
  "q",
  "k",
]);
export const orientationSchema = z.enum(["white-bottom", "black-bottom"]);
export const tokenSchema = z.object({
  sessionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
export type Token = z.infer<typeof tokenSchema>;
export type Side = z.infer<typeof sideSchema>;
export type Orientation = z.infer<typeof orientationSchema>;
export const placementSchema = z
  .object({ square: squareSchema, piece: pieceSchema })
  .strict();
export type Placement = z.infer<typeof placementSchema>;
export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    (r) => r.x + r.width <= 1.001 && r.y + r.height <= 1.001,
    "Crop exceeds the source",
  );
export const selectionSchema = tokenSchema
  .extend({
    sourceId: z.string().regex(/^window:\d+:\d+$/),
    crop: cropSchema,
    orientation: orientationSchema,
    coachedSide: sideSchema,
    sourceWidth: z.number().int().positive(),
    sourceHeight: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      Math.abs(
        value.crop.width * value.sourceWidth -
          value.crop.height * value.sourceHeight,
      ) /
        Math.max(
          value.crop.width * value.sourceWidth,
          value.crop.height * value.sourceHeight,
        ) <
      0.05,
    "The selected board crop must be square in source pixels.",
  );
export type CaptureSelection = z.infer<typeof selectionSchema>;
export const visionSchema = z
  .object({
    placements: z.array(placementSchema).max(32),
    orientation: orientationSchema,
    uncertainSquares: z.array(squareSchema).max(64),
    boardVisible: z.boolean(),
    cropAligned: z.boolean(),
  })
  .strict();
export type VisionResult = z.infer<typeof visionSchema>;
export type BoardObservation = Token & VisionResult & { frameId: number };
export type ConfirmedPosition = Token & {
  fen: string;
  initialFen: string;
  moves: string[];
  historyComplete: boolean;
  coachedSide: Side;
  orientation: Orientation;
};
export type EngineScore = { type: "cp" | "mate"; value: number };
export type Candidate = {
  id: string;
  san: string;
  plain: string;
  score: EngineScore;
  depth: number;
  variation: { uci: string; san: string }[];
};
export type EngineAnalysis = Token & {
  candidates: Candidate[];
  elapsedMs: number;
  terminal: "checkmate" | "stalemate" | null;
};
export type MoveExplanation = Token & {
  candidateId: string;
  explanation: string;
  reply: string | null;
  benefit: string;
  drawback: string;
};
export type SessionStatus = Token & {
  state:
    | "Paused"
    | "Reading board"
    | "Analyzing"
    | "Ready"
    | "Needs correction";
  message: string;
  error?: {
    code: "capture" | "recognition" | "engine" | "position" | "shortcut";
    action: string;
  };
};
export const modelSchema = z.enum(["gpt-6-astra", "gpt-6.1-sol"]);
export const effortSchema = z.enum(["low", "medium", "high", "xhigh"]);
export const aiSettingSchema = z
  .object({ model: modelSchema, effort: effortSchema })
  .strict();
export const settingsSchema = z
  .object({
    recognition: aiSettingSchema,
    explanations: aiSettingSchema,
    shortcuts: z
      .object({
        toggle: z.string().min(1).max(80),
        pause: z.string().min(1).max(80),
        rescan: z.string().min(1).max(80),
      })
      .strict(),
    automaticTracking: z.boolean(),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  recognition: { model: "gpt-6.1-sol", effort: "low" },
  explanations: { model: "gpt-6.1-sol", effort: "medium" },
  shortcuts: {
    toggle: "Command+Shift+H",
    pause: "Command+Shift+P",
    rescan: "Command+Shift+R",
  },
  automaticTracking: false,
};
export const correctionSchema = tokenSchema
  .extend({
    format: z.enum(["fen", "pgn", "start"]),
    text: z.string().max(100000),
    coachedSide: sideSchema,
    orientation: orientationSchema,
    confirmed: z.literal(true),
  })
  .strict();
export type Correction = z.infer<typeof correctionSchema>;
export const playedMoveSchema = tokenSchema
  .extend({ move: z.string().trim().min(2).max(16).regex(/^[a-zA-Z0-9+#=x-]+$/) })
  .strict();
export type PlayedMove = z.infer<typeof playedMoveSchema>;
export type Source = { id: string; name: string; thumbnail: string };
export type Snapshot = {
  status: SessionStatus;
  position: ConfirmedPosition | null;
  analysis: EngineAnalysis | null;
  explanations: MoveExplanation[];
  explanationState: "idle" | "loading" | "ready" | "unavailable";
  observation: BoardObservation | null;
  selection: CaptureSelection | null;
  settings: Settings;
  hasApiKey: boolean;
  trackingQualified: boolean;
  shortcutConflicts: string[];
  running: boolean;
};
export const frameSchema = tokenSchema
  .extend({
    frameId: z.number().int().nonnegative(),
    image: z
      .string()
      .max(4000000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
    signature: z.array(z.number().int().min(0).max(255)).length(64 * 64),
    sourceWidth: z.number().int().min(64).max(16384),
    sourceHeight: z.number().int().min(64).max(16384),
  })
  .strict();
export type CapturedFrame = z.infer<typeof frameSchema>;
export const captureFailureSchema = tokenSchema
  .extend({
    code: z.enum(["permission-denied", "source-ended", "unavailable", "frame-failed", "timeout"]),
  })
  .strict();
export type CaptureFailure = z.infer<typeof captureFailureSchema>;
export type CaptureFailureCode = CaptureFailure["code"];
export type CaptureCommand = Token & {
  action: "start" | "stop" | "sample";
  selection: CaptureSelection | null;
};
export type Cursor = { visible: boolean; epoch: number; x: number; y: number };
export interface ChessHelperAPI {
  snapshot(): Promise<Snapshot>;
  subscribe(callback: (snapshot: Snapshot) => void): () => void;
  onCapture(callback: (command: CaptureCommand) => void): () => void;
  onVisibility(callback: (visible: boolean) => void): () => void;
  sources(token: Token): Promise<Source[]>;
  selectSource(token: Token & { sourceId: string }): Promise<void>;
  selectBoard(selection: CaptureSelection): Promise<void>;
  correct(correction: Correction): Promise<void>;
  recordMove(move: PlayedMove): Promise<void>;
  start(token: Token): Promise<void>;
  pause(token: Token): Promise<void>;
  rescan(token: Token): Promise<void>;
  frame(frame: CapturedFrame): Promise<void>;
  captureError(failure: CaptureFailure): Promise<void>;
  saveSettings(
    token: Token & { settings: Settings; apiKey?: string },
  ): Promise<void>;
  retryExplanation(token: Token): Promise<void>;
  restartEngine(token: Token): Promise<void>;
  openWindow(name: "settings" | "selection" | "correction"): Promise<void>;
  hide(): Promise<void>;
  cursor(): Promise<Cursor>;
  hitTest(value: { epoch: number; interactive: boolean }): Promise<void>;
  screenPermission(): Promise<string>;
  openScreenSettings(): Promise<void>;
}
