export type GridImage = { width: number; height: number; data: Uint8Array; order: "rgba" | "bgra" };
export type BoardGrid = { x: number; y: number; cellWidth: number; cellHeight: number };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

/** Register the entire checkerboard. Piece locations never influence alignment. */
export function findBoardGrid(image: GridImage): BoardGrid | null {
  const channel = image.order === "rgba" ? [0, 1, 2] : [2, 1, 0];
  const rgb = (x: number, y: number) => {
    x = Math.max(0, Math.min(image.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(image.height - 1, Math.round(y)));
    const i = (y * image.width + x) * 4;
    return channel.map(c => image.data[i + c]);
  };
  const axis = (horizontal: boolean, otherOrigin: number, otherCell: number) => {
    const size = horizontal ? image.height : image.width, nominal = size / 8;
    const radius = Math.max(2, Math.round(nominal * 0.2));
    const lines: { index: number; coordinate: number; strength: number }[] = [];
    for (let index = 1; index < 8; index++) {
      let best = { coordinate: index * nominal, strength: 0 };
      for (let offset = -radius; offset <= radius; offset++) {
        const coordinate = Math.round(index * nominal) + offset;
        const contrasts: number[] = [];
        for (let row = 0; row < 8; row++) for (const fraction of [0.16, 0.84]) {
          const other = otherOrigin + (row + fraction) * otherCell;
          const before = horizontal ? rgb(other, coordinate - 1) : rgb(coordinate - 1, other);
          const after = horizontal ? rgb(other, coordinate + 1) : rgb(coordinate + 1, other);
          contrasts.push(before.reduce((sum, v, c) => sum + Math.abs(v - after[c]), 0) / 3);
        }
        const strength = median(contrasts);
        if (strength > best.strength || (strength === best.strength && Math.abs(offset) < Math.abs(best.coordinate - index * nominal)))
          best = { coordinate, strength };
      }
      if (best.strength < 20) return null;
      lines.push({ index, ...best });
    }
    // Fit all seven boundaries together. Rounded/resampled edges can alternate
    // between 63 and 65 pixels for a real 64-pixel tile; a gap median would drift.
    const center = lines.reduce((sum, line) => sum + line.coordinate, 0) / lines.length;
    const spacing = lines.reduce((sum, line) => sum + (line.index - 4) * line.coordinate, 0) / 28;
    const origin = center - 4 * spacing;
    if (spacing < nominal * 0.94 || spacing > nominal * 1.06 ||
      Math.abs(origin) > nominal * 0.2 || Math.abs(origin + 8 * spacing - size) > nominal * 0.2 ||
      lines.some(line => Math.abs(line.coordinate - (origin + line.index * spacing)) > Math.max(1.5, nominal * 0.02)))
      return null;
    return { origin, spacing };
  };
  const x = axis(false, 0, image.height / 8);
  if (!x) return null;
  const y = axis(true, x.origin, x.spacing);
  if (!y || Math.abs(x.spacing - y.spacing) / Math.max(x.spacing, y.spacing) > 0.03) return null;
  return { x: x.origin, y: y.origin, cellWidth: x.spacing, cellHeight: y.spacing };
}
