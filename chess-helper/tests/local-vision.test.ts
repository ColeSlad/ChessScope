import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import jpeg from "jpeg-js";
import { LocalBoardReader, type BoardProfile, type PixelImage } from "../src/core/local-vision";
import templates from "../src/data/local-templates.json";
import manifest from "./fixtures/manifest.json";
import { fixtureManifestSchema } from "../scripts/fixture-schema";
import { importPosition, matchObservation, placementKey, placementsOf } from "../src/core/position";

const reader = new LocalBoardReader(templates.profiles as BoardProfile[]);
const token = { sessionId: "00000000-0000-4000-8000-000000000000", revision: 0 };
const cases = fixtureManifestSchema.parse(manifest).cases;
const decode = (file: string): PixelImage => ({
  ...jpeg.decode(fs.readFileSync(file), { useTArray: true }), order: "rgba",
});

describe("local reading of real recorded boards", () => {
  it.each(cases)("validates $id without accepting an incorrect position", fixture => {
    const file = `tests/fixtures/${fixture.image}`;
    expect(createHash("sha256").update(fs.readFileSync(file)).digest("hex")).toBe(fixture.sha256);
    const observation = reader.read(decode(file), fixture.orientation);
    const correction = !observation.boardVisible || !observation.cropAligned || observation.uncertainSquares.length > 0;
    if (fixture.expectsCorrection && !fixture.beforeFen) expect(correction).toBe(true);
    if (!correction) {
      expect(placementKey(observation.placements)).toBe(placementKey(placementsOf(fixture.expectedFen!)));
      if (fixture.beforeFen) {
        const position = importPosition({ ...token, format: "fen", text: fixture.beforeFen,
          coachedSide: "w", orientation: fixture.orientation, confirmed: true }, 0);
        const result = matchObservation(position, observation);
        if (fixture.expectsCorrection) expect(result.kind).toBe("correction");
        else {
          expect(result.kind).not.toBe("correction");
          if (result.kind === "move") expect(result.position.fen).toBe(fixture.expectedFen);
        }
      }
    }
    // Every ordinary stable move must be readable. Obscuring terminal badges
    // may request correction; they must never manufacture a hidden king.
    if (!fixture.expectsCorrection && !fixture.tags.includes("checkmate") && !fixture.tags.includes("stalemate"))
      expect(correction).toBe(false);
    if (fixture.tags.includes("animation") || fixture.tags.includes("ambiguous")) expect(correction).toBe(true);
  });

  it("learns only from the two initial recordings, with 44 distinct evaluation recordings", () => {
    expect(templates.training.map(t => t.id)).toEqual(["lichess-start-white", "chesscom-start-white"]);
    expect(cases.filter(c => !templates.training.some(t => t.id === c.id))).toHaveLength(44);
  });

  it("gives identical results for native BGRA and test RGBA pixel layouts", () => {
    const image = decode("tests/fixtures/chesscom-midgame-white.jpg");
    const data = new Uint8Array(image.data);
    for (let i = 0; i < data.length; i += 4) [data[i], data[i + 2]] = [data[i + 2], data[i]];
    expect(reader.read({ ...image, data, order: "bgra" }, "white-bottom")).toEqual(reader.read(image, "white-bottom"));
  });

  it("rejects flat images, unsupported board colors and incomplete pixel buffers", () => {
    const image = decode("tests/fixtures/lichess-start-white.jpg");
    expect(reader.read({ ...image, data: new Uint8Array(image.data.length).fill(160) }, "white-bottom").boardVisible).toBe(false);
    const recolored = new Uint8Array(image.data);
    for (let i = 0; i < recolored.length; i += 4) recolored[i] = Math.max(0, recolored[i] - 100);
    expect(reader.read({ ...image, data: recolored }, "white-bottom").boardVisible).toBe(false);
    expect(reader.read({ ...image, data: image.data.subarray(0, 10) }, "white-bottom").boardVisible).toBe(false);
  });

  it("does not accept a board flip as a legal continuation of the confirmed position", () => {
    const position = importPosition({ ...token, format: "start", text: "", coachedSide: "w", orientation: "white-bottom", confirmed: true }, 0);
    const flipped = reader.read(decode("tests/fixtures/lichess-start-black.jpg"), "white-bottom");
    expect(matchObservation(position, flipped).kind).toBe("correction");
  });
});
