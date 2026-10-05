export function signatureDistance(a: number[], b: number[]): number {
  if (a.length !== 4096 || b.length !== 4096) return Infinity;
  // Compare each square independently so one quiet move cannot disappear in a whole-board mean.
  let maximum = 0;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    let sum = 0;
    for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) { const i = (row * 8 + y) * 64 + col * 8 + x; sum += Math.abs(a[i] - b[i]); }
    maximum = Math.max(maximum, sum / 36);
  }
  return maximum;
}
export class StableFrames {
  private previous: number[] | null = null;
  private sent: number[] | null = null;
  private stableCount = 0;
  reset() { this.previous = null; this.sent = null; this.stableCount = 0; }
  ingest(signature: number[]) {
    const changed = !!this.previous && signatureDistance(signature, this.previous) > 3;
    this.stableCount = !this.previous || changed ? 1 : this.stableCount + 1;
    this.previous = signature;
    const ready = this.stableCount >= 2 && (!this.sent || signatureDistance(signature, this.sent) > 3);
    if (ready) this.sent = signature;
    return { changed, ready };
  }
}
