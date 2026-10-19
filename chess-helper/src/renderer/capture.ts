import type { CaptureCommand, CaptureFailureCode, ChessHelperAPI } from "../shared/contracts";
import { captureFailureCode } from "../core/capture-errors";

export function requestBoardStream(): Promise<MediaStream> {
  // Screen Capture defines cursor exclusion; TypeScript's DOM constraints omit it.
  const video: MediaTrackConstraints & { cursor: "never" } = { frameRate: 2, cursor: "never" };
  return navigator.mediaDevices.getDisplayMedia({ audio: false, video });
}

export function boardSignature(canvas: HTMLCanvasElement): number[] {
  const thumb = document.createElement("canvas");
  thumb.width = thumb.height = 64;
  const context = thumb.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, 64, 64);
  const rgba = context.getImageData(0, 0, 64, 64).data;
  const gray = Array.from({ length: 4096 }, (_, i) =>
    Math.round(
      rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114,
    ),
  );
  // Local edges discard flat highlight colors; square margins are excluded by stability.ts.
  return gray.map((value, i) =>
    i % 64 === 63 || i >= 4032
      ? 0
      : Math.min(
          255,
          Math.abs(value - gray[i + 1]) + Math.abs(value - gray[i + 64]),
        ),
  );
}
export class BoardCapture {
  private stream: MediaStream | null = null;
  private video = document.createElement("video");
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private command: CaptureCommand | null = null;
  private starting = false;
  private frame = 0;
  private samples = 0;
  private nativeActive = false;
  constructor(private api: ChessHelperAPI) {
    this.video.muted = true;
    this.video.playsInline = true;
  }
  async receive(command: CaptureCommand) {
    if (command.action === "stop" || !command.selection) {
      this.stop();
      return;
    }
    const previous = this.command;
    const sameSource =
      previous?.selection?.sourceId === command.selection.sourceId &&
      JSON.stringify(previous.selection.crop) ===
        JSON.stringify(command.selection.crop);
    this.command = command;
    if (sameSource && (this.stream || this.starting || this.nativeActive)) return;
    this.stop();
    this.command = command;
    this.starting = true;
    const epoch = this.epoch;
    if (this.api.nativeFrame) {
      this.starting = false;
      this.nativeActive = true;
      this.samples = 0;
      this.tick(epoch);
      return;
    }
    try {
      const stream = await requestBoardStream();
      if (epoch !== this.epoch) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      stream
        .getVideoTracks()[0]
        ?.addEventListener("ended", () => this.fail(epoch, "source-ended"));
      await this.video.play();
      if (epoch !== this.epoch) return;
      this.starting = false;
      this.samples = 0;
      this.tick(epoch);
    } catch (error) {
      if (epoch === this.epoch) this.fail(epoch, captureFailureCode(error));
    }
  }
  private isCurrent(epoch: number, command: CaptureCommand) {
    return epoch === this.epoch && this.command?.sessionId === command.sessionId && this.command.revision === command.revision;
  }
  private fail(epoch: number, code: CaptureFailureCode, command = this.command) {
    if (!command || !this.isCurrent(epoch, command)) return;
    this.stop();
    void this.api.captureError({
      sessionId: command.sessionId,
      revision: command.revision,
      code,
    }).catch(() => {}); // A newer session may already have replaced this capture.
  }
  private tick(epoch: number) {
    if (epoch !== this.epoch || !this.command?.selection || (!this.stream && !this.nativeActive))
      return;
    const started = performance.now();
    const command = this.command;
    const send = async () => {
      const selection = command.selection!;
      if (this.api.nativeFrame) {
        const result = await this.api.nativeFrame({ sessionId: command.sessionId, revision: command.revision });
        if (!this.isCurrent(epoch, command)) return;
        if ("error" in result) { this.fail(epoch, result.error); return; }
        const image = new Image();
        image.src = result.frame.image;
        await image.decode();
        if (!this.isCurrent(epoch, command)) return;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = image.naturalWidth;
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        await this.api.frame({ sessionId: command.sessionId, revision: command.revision,
          frameId: ++this.frame, ...result.frame,
          signature: boardSignature(canvas) });
        if (this.isCurrent(epoch, command) && ++this.samples > 120 && command.action === "sample") this.fail(epoch, "timeout", command);
        return;
      }
      const width = this.video.videoWidth,
        height = this.video.videoHeight;
      if (!width || !height || this.video.readyState < 2) return;
      if (this.stream!.getVideoTracks()[0].muted) {
        this.fail(epoch, "source-ended");
        return;
      }
      const crop = selection.crop;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(
        1024,
        Math.round(width * crop.width),
      );
      canvas
        .getContext("2d")!
        .drawImage(
          this.video,
          crop.x * width,
          crop.y * height,
          crop.width * width,
          crop.height * height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      const image = canvas.toDataURL("image/jpeg", 0.9),
        signature = boardSignature(canvas);
      // No full-window frame crosses IPC or reaches the cloud; the canvas exists only in memory.
      await this.api.frame({
        sessionId: command.sessionId,
        revision: command.revision,
        frameId: ++this.frame,
        image,
        signature,
        sourceWidth: width,
        sourceHeight: height,
      });
      if (
        this.isCurrent(epoch, command) &&
        ++this.samples > 120 &&
        command.action === "sample"
      )
        this.fail(epoch, "timeout");
    };
    void send()
      .catch(() => this.fail(epoch, "frame-failed", command))
      .finally(() => {
        if (epoch === this.epoch)
          this.timer = setTimeout(
            () => this.tick(epoch),
            Math.max(0, 500 - (performance.now() - started)),
          );
      });
  }
  stop() {
    ++this.epoch;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.starting = false;
    this.nativeActive = false;
    this.command = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
