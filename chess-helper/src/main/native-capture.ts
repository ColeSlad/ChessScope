import { createRequire } from "node:module";
import { z } from "zod";
import { frameSchema, type CaptureSelection, type NativeBoardFrame } from "../shared/contracts";
const outputSchema = frameSchema.pick({ image: true, sourceWidth: true, sourceHeight: true });
const failureSchema = z.object({ error: z.enum(["permission-denied", "source-ended", "unavailable"]) }).strict();
type Binding = { capture(request: { windowID: number; crop: CaptureSelection["crop"] }): Promise<unknown> };
export class NativeCaptureError extends Error {
  constructor(readonly code: "permission-denied" | "source-ended" | "unavailable") { super("Native board capture unavailable"); }
}
export class NativeWindowCapture {
  private binding: Binding | null = null;
  private busy = false;
  private pending: (() => void) | null = null;
  constructor(private addon: string, private load: (file: string) => Binding = file => createRequire(__filename)(file)) {}
  capture(selection: CaptureSelection): Promise<NativeBoardFrame> {
    const match = /^window:(\d+):\d+$/.exec(selection.sourceId);
    if (!match || Number(match[1]) < 1 || this.busy) return Promise.reject(new NativeCaptureError("unavailable"));
    this.busy = true;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: NativeCaptureError, frame?: NativeBoardFrame) => {
        if (done) return;
        done = true; clearTimeout(timer); this.pending = null;
        if (error) reject(error); else resolve(frame!);
      };
      const timer = setTimeout(() => finish(new NativeCaptureError("unavailable")), 5000);
      this.pending = () => finish(new NativeCaptureError("unavailable"));
      void Promise.resolve().then(async () => {
        if (done) return;
        this.binding ??= this.load(this.addon);
        const value = await this.binding.capture({ windowID: Number(match[1]), crop: selection.crop });
        if (done) return;
        const failure = failureSchema.safeParse(value);
        if (failure.success) finish(new NativeCaptureError(failure.data.error));
        else finish(undefined, outputSchema.parse(value));
      }).catch(() => finish(new NativeCaptureError("unavailable"))).finally(() => { this.busy = false; });
    });
  }
  // An in-flight OS screenshot may finish; pause discards it and stops new requests.
  cancel() { this.pending?.(); }
}
