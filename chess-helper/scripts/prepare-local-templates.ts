import fs from "node:fs";
import { createHash } from "node:crypto";
import jpeg from "jpeg-js";
import { placementsOf } from "../src/core/position";
import { squareImage, type BoardProfile, type RGB } from "../src/core/local-vision";
import { findBoardGrid } from "../src/core/board-grid";
import manifest from "../tests/fixtures/manifest.json";

const profiles: BoardProfile[] = [];
const training = [];
for (const id of ["lichess-start-white", "chesscom-start-white"]) {
  const fixture = manifest.cases.find(c => c.id === id)!;
  const bytes = fs.readFileSync(`tests/fixtures/${fixture.image}`);
  if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) throw new Error(`Changed training recording: ${id}`);
  const image = { ...jpeg.decode(bytes, { useTArray: true }), order: "rgba" as const };
  const grid = findBoardGrid(image);
  if (!grid) throw new Error(`Training board grid was not found: ${id}`);
  const colors: RGB[][] = [[], []];
  const templates: BoardProfile["templates"] = [];
  const pieces = new Map(placementsOf(fixture.expectedFen!).map(p => [p.square, p.piece]));
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const s = squareImage(image, row, col, grid);
    colors[(row + col) % 2].push(s.background);
    const piece = pieces.get(`${"abcdefgh"[col]}${8 - row}`);
    if (piece) templates.push({ piece, data: Buffer.from(s.feature).toString("base64") });
  }
  const palette = colors.map(samples => [0, 1, 2].map(channel => Math.round(samples.map(c => c[channel]).sort((a,b) => a-b)[samples.length >> 1])) as RGB);
  profiles.push({ id: fixture.site, label: fixture.site === "lichess" ? "Lichess brown / cburnett" : "Chess.com green / default", light: palette[0], dark: palette[1], templates });
  training.push({ id, sha256: fixture.sha256 });
}
fs.mkdirSync("src/data", { recursive: true });
fs.writeFileSync("src/data/local-templates.json", JSON.stringify({ version: 1, training, profiles }) + "\n");
console.log(JSON.stringify({ training, profiles: profiles.map(p => ({ id: p.id, templates: p.templates.length, light: p.light, dark: p.dark })) }));
