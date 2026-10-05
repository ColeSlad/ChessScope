export type Rect = { x: number; y: number; width: number; height: number };
export function clampWindow(saved: Rect, displays: Rect[]): Rect {
  const overlap = (d: Rect) => Math.max(0, Math.min(saved.x + saved.width, d.x + d.width) - Math.max(saved.x, d.x)) * Math.max(0, Math.min(saved.y + saved.height, d.y + d.height) - Math.max(saved.y, d.y));
  const display = [...displays].sort((a,b) => overlap(b) - overlap(a))[0];
  if (!display) return saved;
  const width = Math.min(Math.max(340, saved.width), display.width), height = Math.min(Math.max(480, saved.height), display.height);
  return { x: Math.max(display.x, Math.min(saved.x, display.x + display.width - width)), y: Math.max(display.y, Math.min(saved.y, display.y + display.height - height)), width, height };
}
export class MouseEpoch {
  epoch = 0; visible = false;
  show() { this.visible = true; return ++this.epoch; }
  hide() { this.visible = false; return ++this.epoch; }
  accepts(epoch: number) { return this.visible && this.epoch === epoch; }
}
