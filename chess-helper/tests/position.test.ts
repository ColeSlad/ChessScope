import { describe, it, expect } from "vitest";
import { Chess, DEFAULT_POSITION } from "chess.js";
import {
  importPosition,
  matchObservation,
  placementsOf,
  validatePosition,
  legalCandidate,
  whiteScore,
  displayScore,
} from "../src/core/position";
const sessionId = "00000000-0000-4000-8000-000000000001";
const position = (fen = DEFAULT_POSITION) =>
  importPosition(
    {
      sessionId,
      revision: 0,
      format: "fen",
      text: fen,
      coachedSide: "w",
      orientation: "white-bottom",
      confirmed: true,
    },
    0,
  );
const observation = (fen: string) => ({
  placements: placementsOf(fen),
  orientation: "white-bottom" as const,
  uncertainSquares: [],
  boardVisible: true,
  cropAligned: true,
});
describe("legal screenshot transitions", () => {
  it.each([
    ["normal move", DEFAULT_POSITION, "e4"],
    ["capture", "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "exd5"],
    ["kingside castle", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "O-O"],
    ["queenside castle", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "O-O-O"],
    ["en passant", "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2", "exd6"],
    ["queen promotion", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a8=Q+"],
    ["underpromotion", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a8=N"],
  ])("accepts exactly one %s", (name, fen, move) => {
    void name;
    const chess = new Chess(fen);
    chess.move(move);
    const result = matchObservation(position(fen), observation(chess.fen()));
    expect(result.kind).toBe("move");
    if (result.kind === "move") {
      expect(result.position.fen.split(" ")[0]).toBe(chess.fen().split(" ")[0]);
      expect(result.position.moves).toHaveLength(1);
    }
  });
  it("requires correction after missed moves", () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("e5");
    expect(matchObservation(position(), observation(chess.fen())).kind).toBe(
      "correction",
    );
  });
  it("refuses uncertainty even when pieces happen to match", () => {
    expect(
      matchObservation(position(), {
        ...observation(DEFAULT_POSITION),
        uncertainSquares: ["e2"],
      }).kind,
    ).toBe("correction");
  });
  it("revalidates flips, crop alignment and visibility", () => {
    for (const extra of [
      { orientation: "black-bottom" as const },
      { cropAligned: false },
      { boardVisible: false },
    ])
      expect(
        matchObservation(position(), {
          ...observation(DEFAULT_POSITION),
          ...extra,
        }).kind,
      ).toBe("correction");
  });
  it("does not accept duplicate squares", () => {
    const value = observation(DEFAULT_POSITION);
    value.placements.push(value.placements[0]);
    expect(matchObservation(position(), value).kind).toBe("correction");
  });
  it("reports unchanged placement without changing special rights", () => {
    expect(matchObservation(position(), observation(DEFAULT_POSITION))).toEqual(
      { kind: "unchanged" },
    );
  });
});
describe("explicit initial state", () => {
  it("does not infer history from starting FEN", () =>
    expect(position().historyComplete).toBe(false));
  it("only confirmed starting setup establishes full history", () => {
    const result = importPosition(
      {
        sessionId,
        revision: 0,
        format: "start",
        text: "",
        coachedSide: "b",
        orientation: "black-bottom",
        confirmed: true,
      },
      1,
    );
    expect(result.historyComplete).toBe(true);
    expect(result.fen).toBe(DEFAULT_POSITION);
  });
  it("imports PGN and retains the original position and UCI history", () => {
    const result = importPosition(
      {
        sessionId,
        revision: 0,
        format: "pgn",
        text: "1. e4 e5 2. Nf3",
        coachedSide: "w",
        orientation: "white-bottom",
        confirmed: true,
      },
      1,
    );
    expect(result.moves).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(result.historyComplete).toBe(true);
  });
  it.each([
    "8/8/8/8/8/8/8/8 w - - 0 1",
    "4k3/8/8/8/8/8/8/4K3 w K - 0 1",
    "4k3/8/8/8/8/8/8/4K3 w - d6 0 1",
    "4k3/8/8/8/8/8/8/4K3 w",
    "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1",
  ])("rejects incomplete or inconsistent state %s", (fen) =>
    expect(() => validatePosition(fen)).toThrow(),
  );
  it("recognizes checkmate and stalemate without inventing candidates", () => {
    expect(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1").isCheckmate()).toBe(
      true,
    );
    expect(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").isStalemate()).toBe(
      true,
    );
  });
});
describe("engine evidence", () => {
  it("rejects illegal continuation even if its first move is legal", () =>
    expect(() =>
      legalCandidate(DEFAULT_POSITION, "e2e4", { type: "cp", value: 20 }, 15, [
        "e2e4",
        "e7e4",
      ]),
    ).toThrow());
  it("uses consistent white scores and explicit mate notation", () => {
    expect(displayScore(whiteScore({ type: "cp", value: 87 }, "b"))).toBe(
      "-0.87",
    );
    expect(displayScore(whiteScore({ type: "mate", value: 3 }, "b"))).toBe(
      "Mate Black in 3",
    );
    expect(displayScore({ type: "mate", value: 2 })).toBe("Mate White in 2");
  });
});
