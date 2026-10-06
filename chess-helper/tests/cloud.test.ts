import { it, expect } from "vitest";
import { DEFAULT_POSITION } from "chess.js";
import { validateExplanations, validateVision, decodeCompactVision } from "../src/main/cloud";
import { legalCandidate, importPosition, matchObservation } from "../src/core/position";
import type { EngineAnalysis } from "../src/shared/contracts";
const analysis: EngineAnalysis = {
  sessionId: "s",
  revision: 3,
  candidates: [
    legalCandidate(DEFAULT_POSITION, "e2e4", { type: "cp", value: 20 }, 15, [
      "e2e4",
      "e7e5",
    ]),
  ],
  elapsedMs: 1000,
  terminal: null,
};
const valid = {
  candidates: [
    {
      candidateId: "e2e4",
      explanation: "Occupies the center.",
      reply: "e7e5",
      benefit: "Creates space.",
      drawback: "The pawn may become a target.",
    },
  ],
};
const startingRanks = ["rnbqkbnr", "pppppppp", "........", "........", "........", "........", "PPPPPPPP", "RNBQKBNR"];
it.each(["white-bottom", "black-bottom"])("decodes compact ranks in algebraic coordinates for %s", (orientation) => {
  const result = decodeCompactVision({ ranks: startingRanks, orientation, uncertainSquares: [], boardVisible: true, cropAligned: true, piecesAligned: true });
  expect(result.placements).toHaveLength(32);
  expect(result.placements).toContainEqual({ square: "a8", piece: "r" });
  expect(result.placements).toContainEqual({ square: "h1", piece: "R" });
  expect(result.orientation).toBe(orientation);
});
it("preserves unknown squares instead of treating them as empty", () => {
  const ranks = [...startingRanks];
  ranks[4] = "....?...";
  const result = decodeCompactVision({ ranks, orientation: "white-bottom", uncertainSquares: ["e4", "a3"], boardVisible: true, cropAligned: true, piecesAligned: true });
  expect(result.uncertainSquares).toEqual(["e4", "a3"]);
  expect(result.placements.some((piece) => piece.square === "e4")).toBe(false);
});
it.each([
  startingRanks.slice(1),
  ["rnbqkbn", ...startingRanks.slice(1)],
  ["rnbqkbn!", ...startingRanks.slice(1)],
  Array(8).fill("QQQQQQQQ"),
])("rejects malformed or overpopulated compact boards", (ranks) => {
  expect(() => decodeCompactVision({ ranks, orientation: "white-bottom", uncertainSquares: [], boardVisible: true, cropAligned: true, piecesAligned: true })).toThrow();
});
it("requests correction for a displaced piece even when the guessed ranks form a legal move", () => {
  const token = { sessionId: "00000000-0000-4000-8000-000000000001", revision: 0 };
  const before = importPosition({ ...token, format: "start", text: "", coachedSide: "w", orientation: "white-bottom", confirmed: true }, 0);
  // Real Lichess animation was incorrectly snapped to e3 during an e2-e4 move.
  const ranks = [...startingRanks]; ranks[5] = "....P..."; ranks[6] = "PPPP.PPP";
  const fields = { ranks, orientation: "white-bottom", uncertainSquares: [], boardVisible: true, cropAligned: true };
  const aligned = decodeCompactVision({ ...fields, piecesAligned: true });
  expect(matchObservation(before, aligned).kind).toBe("move");
  const displaced = decodeCompactVision({ ...fields, piecesAligned: false });
  expect(matchObservation(before, displaced).kind).toBe("correction");
});
it("requires an explicit piece-alignment check in compact recognition", () => {
  expect(() => decodeCompactVision({ ranks: startingRanks, orientation: "white-bottom", uncertainSquares: [], boardVisible: true, cropAligned: true })).toThrow();
});
it("binds structured explanation to engine evidence and revision", () =>
  expect(validateExplanations(valid, analysis)[0]).toMatchObject({
    candidateId: "e2e4",
    sessionId: "s",
    revision: 3,
    reply: "e7e5",
  }));
it.each([
  { candidates: [] },
  { candidates: [{ ...valid.candidates[0], reply: "e7e6" }] },
  { candidates: [{ ...valid.candidates[0], candidateId: "d2d4" }] },
  { candidates: [{ ...valid.candidates[0], explanation: "Wins via a2a5." }] },
  { candidates: [valid.candidates[0], valid.candidates[0]] },
  { candidates: [{ ...valid.candidates[0], unknown: "ignored" }] },
])("rejects malformed or unsupported explanation %j", (output) =>
  expect(() => validateExplanations(output, analysis)).toThrow(),
);

it("rejects duplicate occupied squares before they can reach the correction editor", () => {
  expect(() =>
    validateVision({
      placements: [
        { square: "e1", piece: "K" },
        { square: "e1", piece: "Q" },
      ],
      orientation: "white-bottom",
      uncertainSquares: [],
      boardVisible: true,
      cropAligned: true,
    }),
  ).toThrow("duplicate");
});

it("uses the official Responses SDK with structured image input and independent thinking settings", async () => {
  const { vi } = await import("vitest");
  const { CloudAI } = await import("../src/main/cloud");
  const observation = {
    placements: [
      { square: "e8", piece: "k" },
      { square: "e1", piece: "K" },
    ],
    orientation: "white-bottom",
    uncertainSquares: [],
    boardVisible: true,
    cropAligned: true,
  };
  const compact = {
    ranks: ["....k...", "........", "........", "........", "........", "........", "........", "....K..."],
    orientation: "white-bottom", uncertainSquares: [], boardVisible: true, cropAligned: true, piecesAligned: true,
  };
  let request: any;
  const fetch = vi.fn(async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [
          {
            id: "msg_test",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(compact),
                annotations: [],
              },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const cloud = new CloudAI(() => "disposable-test-key");
    const frame = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      revision: 8,
      frameId: 12,
      image: "data:image/jpeg;base64,AAAA",
      signature: Array(4096).fill(0),
      sourceWidth: 1024,
      sourceHeight: 1024,
    };
    const result = await cloud.recognize(
      frame,
      "white-bottom",
      { model: "gpt-6-astra", effort: "xhigh" },
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(request).toMatchObject({
      model: "gpt-6-astra",
      reasoning: { effort: "xhigh" },
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(request.input[0].content[1]).toEqual({
      type: "input_image",
      image_url: frame.image,
      detail: "high",
    });
    expect(result).toMatchObject({
      ...observation,
      sessionId: frame.sessionId,
      revision: 8,
      frameId: 12,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
