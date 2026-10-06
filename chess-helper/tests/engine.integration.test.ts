import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { Chess } from "chess.js";
import { Stockfish } from "../src/main/engine";
import { importPosition, moveUci } from "../src/core/position";

const directory = path.resolve("resources/stockfish");
const installed = existsSync(path.join(directory, "stockfish"));
const engine = new Stockfish(path.join(directory, "stockfish"), directory);
afterAll(() => engine.shutdown());
function position(text: string, revision = 1) {
  return importPosition(
    {
      sessionId: "00000000-0000-4000-8000-000000000001",
      revision,
      format: text ? "fen" : "start",
      text,
      coachedSide: "w",
      orientation: "white-bottom",
      confirmed: true,
    },
    revision,
  );
}

it.skipIf(!installed)(
  "bundled Stockfish produces three engine-ranked, legal candidates for both turns",
  async () => {
    for (const text of [
      "",
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    ]) {
      const p = position(text);
      const result = await engine.analyze(p, new AbortController().signal);
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates.every((c) => c.depth > 0)).toBe(true);
      expect(result.elapsedMs).toBeLessThan(5000);
      for (const candidate of result.candidates) {
        const chess = new Chess(p.fen);
        for (const move of candidate.variation)
          expect(moveUci(chess, move.uci)).toBeTruthy();
      }
    }
  },
  15000,
);

it.skipIf(!installed)(
  "reports White mate scores and terminal positions without invented moves",
  async () => {
    const mate = await engine.analyze(
      position("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1"),
      new AbortController().signal,
    );
    expect(mate.candidates[0].score).toEqual({ type: "mate", value: 1 });
    const blackMate = await engine.analyze(
      position("8/8/8/8/8/6k1/5q2/7K b - - 0 1"),
      new AbortController().signal,
    );
    expect(blackMate.candidates[0].score).toEqual({ type: "mate", value: -1 });
    for (const [fen, terminal] of [
      ["7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", "checkmate"],
      ["7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "stalemate"],
    ]) {
      const result = await engine.analyze(
        position(fen),
        new AbortController().signal,
      );
      expect(result.terminal).toBe(terminal);
      expect(result.candidates).toEqual([]);
    }
  },
  15000,
);

it.skipIf(!installed)(
  "cancels a real search and restarts the engine with a fresh revision",
  async () => {
    const controller = new AbortController();
    const obsolete = engine.analyze(position("", 2), controller.signal);
    const rejection = expect(obsolete).rejects.toThrow();
    setTimeout(() => controller.abort(), 100);
    await rejection;
    await engine.restart();
    const current = await engine.analyze(
      position("", 3),
      new AbortController().signal,
    );
    expect(current.revision).toBe(3);
    expect(current.candidates).toHaveLength(3);
  },
  15000,
);
