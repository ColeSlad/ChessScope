import type { Orientation, Placement, VisionResult } from "../shared/contracts";
import { findBoardGrid, type BoardGrid } from "./board-grid";

export type PixelImage = {
  width: number;
  height: number;
  data: Uint8Array;
  order: "rgba" | "bgra";
};
export type RGB = [number, number, number];
export const FEATURE_SIZE = 28;
export const LOCAL_MATCH_LIMIT = 0.2;
export const LOCAL_MATCH_MARGIN = 0.035;
export type PieceTemplate = { piece: Placement["piece"]; data: string };
export type BoardProfile = {
  id: string;
  label: string;
  light: RGB;
  dark: RGB;
  templates: PieceTemplate[];
};
type SquareImage = { background: RGB; feature: Uint8Array; mass: number; residual: number };
export type LocalObservation = VisionResult & {
  profile: string | null;
  worstDistance: number;
};
const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];
const colorDistance = (a: RGB, b: RGB) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

function pixel(image: PixelImage, x: number, y: number): RGB {
  x = Math.max(0, Math.min(image.width - 1, x));
  y = Math.max(0, Math.min(image.height - 1, y));
  const left = Math.floor(x), top = Math.floor(y);
  const right = Math.min(left + 1, image.width - 1), bottom = Math.min(top + 1, image.height - 1);
  const fx = x - left, fy = y - top;
  const channels = image.order === "rgba" ? [0, 1, 2] : [2, 1, 0];
  return channels.map(channel => {
    const at = (px: number, py: number) => image.data[(py * image.width + px) * 4 + channel];
    return (at(left, top) * (1 - fx) + at(right, top) * fx) * (1 - fy) +
      (at(left, bottom) * (1 - fx) + at(right, bottom) * fx) * fy;
  }) as RGB;
}

/** Normalized foreground shape and brightness, independent of tile/highlight color. */
export function squareImage(image: PixelImage, row: number, col: number,
  grid: BoardGrid = { x: 0, y: 0, cellWidth: image.width / 8, cellHeight: image.height / 8 }): SquareImage {
  const at = (x: number, y: number) => pixel(image,
    grid.x + (col + x) * grid.cellWidth - 0.5, grid.y + (row + y) * grid.cellHeight - 0.5);
  const corners: RGB[] = [];
  for (const x of [0.06, 0.09, 0.91, 0.94])
    for (const y of [0.06, 0.09, 0.91, 0.94]) corners.push(at(x, y));
  for (const value of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
    corners.push(at(value, 0.03), at(value, 0.97), at(0.03, value), at(0.97, value));
  }
  // Labels and the resize grip can contaminate most of a corner. Use the
  // dominant border-color cluster instead of synthesizing a channel median.
  let cluster: RGB[] = [];
  for (const sample of corners) {
    const neighbors = corners.filter(color => colorDistance(sample, color) <= 10);
    if (neighbors.length > cluster.length) cluster = neighbors;
  }
  const background = [0, 1, 2].map(channel => median(cluster.map(c => c[channel]))) as RGB;
  const feature = new Uint8Array(FEATURE_SIZE * FEATURE_SIZE * 2);
  let mass = 0, residual = 0;
  for (let y = 0; y < FEATURE_SIZE; y++) for (let x = 0; x < FEATURE_SIZE; x++) {
    // Exclude board-coordinate text and square edges, retaining the centered piece.
    const nx = 0.1 + (x + 0.5) / FEATURE_SIZE * 0.8, ny = 0.08 + (y + 0.5) / FEATURE_SIZE * 0.82;
    // Lichess draws its resize grip over the bottom-right board corner.
    if (row === 7 && col === 7 && nx > 0.84 && ny > 0.82) continue;
    const rgb = at(nx, ny);
    const contrast = Math.max(0, Math.min(1, (colorDistance(rgb, background) - 10) / 30));
    // Both supported sets use achromatic pieces. Colored check glows and move
    // highlights remain background, rather than becoming false piece silhouettes.
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    const mask = Math.round(contrast * Math.max(0, Math.min(1, (38 - chroma) / 14)) * 255);
    const i = (y * FEATURE_SIZE + x) * 2;
    feature[i] = mask;
    feature[i + 1] = Math.round(rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114);
    mass += mask / 255;
    residual += contrast;
  }
  return { background, feature, mass, residual };
}

function templateDistance(a: Uint8Array, b: Uint8Array): number {
  let shape = 0, color = 0, union = 0, overlap = 0;
  for (let i = 0; i < a.length; i += 2) {
    const ma = a[i] / 255, mb = b[i] / 255;
    shape += (ma - mb) ** 2;
    union += Math.max(ma, mb);
    const shared = Math.min(ma, mb);
    overlap += shared;
    color += shared * ((a[i + 1] - b[i + 1]) / 255) ** 2;
  }
  return shape / Math.max(1, union) + 0.6 * color / Math.max(1, overlap);
}

export class LocalBoardReader {
  private profiles: { profile: BoardProfile; templates: { piece: Placement["piece"]; feature: Uint8Array }[] }[];
  constructor(profiles: BoardProfile[]) {
    this.profiles = profiles.map(profile => ({ profile, templates: profile.templates.map(t => ({
      piece: t.piece, feature: Buffer.from(t.data, "base64"),
    })) }));
    for (const { templates } of this.profiles) {
      if (new Set(templates.map(t => t.piece)).size !== 12 ||
        templates.some(t => t.feature.length !== FEATURE_SIZE * FEATURE_SIZE * 2))
        throw new Error("Invalid local piece templates");
    }
  }
  read(image: PixelImage, orientation: Orientation): LocalObservation {
    const rejected: LocalObservation = {
      placements: [], orientation, uncertainSquares: [], boardVisible: false, cropAligned: false,
      profile: null, worstDistance: 1,
    };
    if (image.width < 256 || image.width > 2048 || image.height !== image.width ||
      image.data.length !== image.width * image.height * 4) return rejected;
    const grid = findBoardGrid(image);
    if (!grid) return rejected;
    const squares = Array.from({ length: 64 }, (_, i) => squareImage(image, i >> 3, i % 8, grid));
    const palette = (parity: number): RGB => [0, 1, 2].map(channel =>
      median(squares.filter((_, i) => ((i >> 3) + i % 8) % 2 === parity).map(s => s.background[channel]))) as RGB;
    const light = palette(0), dark = palette(1);
    const choices = this.profiles.map(p => ({ ...p,
      distance: Math.max(colorDistance(light, p.profile.light), colorDistance(dark, p.profile.dark)),
    })).sort((a, b) => a.distance - b.distance);
    const selected = choices[0];
    if (!selected || selected.distance > 25) return rejected;
    const placements: Placement[] = [], uncertainSquares: string[] = [];
    let worstDistance = 0;
    squares.forEach((s, i) => {
      const row = i >> 3, col = i % 8;
      const square = orientation === "white-bottom" ? `${"abcdefgh"[col]}${8 - row}` : `${"hgfedcba"[col]}${row + 1}`;
      const expectedBackground = (row + col) % 2 ? selected.profile.dark : selected.profile.light;
      if (colorDistance(s.background, expectedBackground) > 80) {
        uncertainSquares.push(square); return;
      }
      if (s.mass < FEATURE_SIZE * FEATURE_SIZE * 0.015) {
        if (s.residual > FEATURE_SIZE * FEATURE_SIZE * 0.015) uncertainSquares.push(square);
        return;
      }
      const byPiece = new Map<Placement["piece"], number>();
      for (const template of selected.templates) {
        const distance = templateDistance(s.feature, template.feature);
        byPiece.set(template.piece, Math.min(byPiece.get(template.piece) ?? Infinity, distance));
      }
      const ranked = [...byPiece].sort((a, b) => a[1] - b[1]);
      const [piece, distance] = ranked[0];
      worstDistance = Math.max(worstDistance, distance);
      if (distance > LOCAL_MATCH_LIMIT || ranked[1][1] - distance < LOCAL_MATCH_MARGIN) uncertainSquares.push(square);
      else placements.push({ square, piece });
    });
    const sane = placements.length <= 32 &&
      placements.filter(p => p.piece === "K").length === 1 && placements.filter(p => p.piece === "k").length === 1;
    return { placements: placements.slice(0, 32), orientation, uncertainSquares,
      boardVisible: sane, cropAligned: sane && uncertainSquares.length === 0,
      profile: selected.profile.id, worstDistance };
  }
}
