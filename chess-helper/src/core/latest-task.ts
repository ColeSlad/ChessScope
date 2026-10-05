/** Exactly one active task and one replaceable pending task, including when abort is slow. */
export class LatestTask<T> {
  private pending: T | null = null;
  private active: AbortController | null = null;
  constructor(private run: (value: T, signal: AbortSignal) => Promise<void>) {}
  submit(value: T) { this.pending = value; this.active?.abort(); void this.drain(); }
  cancel() { this.pending = null; this.active?.abort(); }
  get busy() { return this.active !== null; }
  private async drain() {
    if (this.active || this.pending === null) return;
    const value = this.pending; this.pending = null;
    const controller = new AbortController(); this.active = controller;
    try { await this.run(value, controller.signal); } finally { this.active = null; if (this.pending !== null) void this.drain(); }
  }
}
