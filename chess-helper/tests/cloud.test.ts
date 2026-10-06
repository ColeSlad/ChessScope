import { it, expect } from "vitest";
import { DEFAULT_POSITION } from "chess.js";
import { validateExplanations, validateVision } from "../src/main/cloud";
import { legalCandidate } from "../src/core/position";
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
      { square: "e1", piece: "K" },
      { square: "e8", piece: "k" },
    ],
    orientation: "white-bottom",
    uncertainSquares: [],
    boardVisible: true,
    cropAligned: true,
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
                text: JSON.stringify(observation),
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
