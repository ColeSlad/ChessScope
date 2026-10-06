import { z } from "zod";
import { Chess } from "chess.js";
import { validatePosition } from "../src/core/position";

export const REQUIRED_FIXTURE_TAGS = [
  "default-2d", "white-bottom", "black-bottom", "retina", "resize", "highlight",
  "animation", "move", "capture", "castling", "en-passant", "promotion",
  "checkmate", "stalemate", "midgame", "missed-moves", "ambiguous",
] as const;
const fen = z.string().refine(value => {
  try { validatePosition(value); return true; } catch { return false; }
}, "Fixture FEN must contain valid, explicit chess state");
export const fixtureSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  site: z.enum(["chess.com", "lichess"]),
  tags: z.array(z.enum(REQUIRED_FIXTURE_TAGS)).min(1),
  image: z.string().regex(/^[a-z0-9][a-z0-9-]*\.(jpg|jpeg|png)$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  orientation: z.enum(["white-bottom", "black-bottom"]),
  beforeFen: fen.nullable(),
  expectedFen: fen.nullable(),
  expectsCorrection: z.boolean(),
  recording: z.object({
    recordedAt: z.iso.datetime(), url: z.url(), theme: z.literal("default-2d"),
    pixelWidth: z.number().int().min(64).max(8192),
    pixelHeight: z.number().int().min(64).max(8192),
    scaleFactor: z.number().min(1).max(4),
    notes: z.string().min(1).max(1000),
  }).strict(),
}).strict().superRefine((item, ctx) => {
  const host = new URL(item.recording.url).hostname;
  const expectedHost = item.site === "lichess" ? "lichess.org" : "chess.com";
  if (host !== expectedHost && host !== `www.${expectedHost}`)
    ctx.addIssue({ code: "custom", message: "Recording URL does not match the fixture site" });
  if (!item.expectedFen && !item.expectsCorrection)
    ctx.addIssue({ code: "custom", message: "Readable fixtures require ground-truth FEN" });
  if (item.tags.includes("retina") && item.recording.scaleFactor < 2)
    ctx.addIssue({ code: "custom", message: "Retina coverage requires a recorded scale factor of at least 2" });
  if (!item.tags.includes(item.orientation))
    ctx.addIssue({ code: "custom", message: "Tags must include the recorded orientation" });
  if (new Set(item.tags).size !== item.tags.length)
    ctx.addIssue({ code: "custom", message: "Duplicate coverage tags" });
  if (item.tags.some(tag => tag === "ambiguous" || tag === "missed-moves") && !item.expectsCorrection)
    ctx.addIssue({ code: "custom", message: "Ambiguous or missed-move cases must expect correction" });
  const moveTags = item.tags.filter(tag => ["move", "capture", "castling", "en-passant", "promotion"].includes(tag));
  if (moveTags.length && (!item.beforeFen || !item.expectedFen))
    ctx.addIssue({ code: "custom", message: "Move coverage requires before and after FEN" });
  try {
    if (moveTags.length && item.beforeFen && item.expectedFen) {
      const chess = new Chess(item.beforeFen);
      const expected = new Chess(item.expectedFen).fen({ forceEnpassantSquare: true });
      const move = chess.moves({ verbose: true }).find(candidate => {
        chess.move(candidate);
        const matches = chess.fen({ forceEnpassantSquare: true }) === expected;
        chess.undo();
        return matches;
      });
      if (!move || (item.tags.includes("capture") && !move.isCapture() && !move.isEnPassant()) ||
        (item.tags.includes("castling") && !move.isKingsideCastle() && !move.isQueensideCastle()) ||
        (item.tags.includes("en-passant") && !move.isEnPassant()) ||
        (item.tags.includes("promotion") && !move.isPromotion()))
        ctx.addIssue({ code: "custom", message: "Move coverage tags must match the actual legal transition" });
    }
    if (item.expectedFen) {
      const chess = new Chess(item.expectedFen);
      if ((item.tags.includes("checkmate") && !chess.isCheckmate()) ||
        (item.tags.includes("stalemate") && !chess.isStalemate()))
        ctx.addIssue({ code: "custom", message: "Terminal coverage tags must match the actual position" });
    }
  } catch { /* Invalid FEN is reported by the field validator. */ }
});
export type Fixture = z.infer<typeof fixtureSchema>;
export const fixtureManifestSchema = z.object({
  version: z.literal(2), description: z.string().min(1), cases: z.array(fixtureSchema),
}).strict().superRefine((manifest, ctx) => {
  if (new Set(manifest.cases.map(c => c.id)).size !== manifest.cases.length)
    ctx.addIssue({ code: "custom", message: "Duplicate fixture identifiers" });
  if (new Set(manifest.cases.map(c => c.sha256)).size !== manifest.cases.length)
    ctx.addIssue({ code: "custom", message: "Duplicate recordings cannot count as independent coverage" });
});
export function missingCoverage(fixtures: Fixture[]) {
  return ["chess.com", "lichess"].flatMap(site => REQUIRED_FIXTURE_TAGS
    .filter(tag => !fixtures.some(item => item.site === site && item.tags.includes(tag)))
    .map(tag => ({ site, tag })));
}
