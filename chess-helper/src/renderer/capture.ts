import type { CaptureCommand, ChessHelperAPI } from '../shared/contracts';

export function boardSignature(canvas: HTMLCanvasElement): number[] {
  const thumb = document.createElement('canvas'); thumb.width = thumb.height = 64;
  const context = thumb.getContext('2d', { willReadFrequently: true })!; context.drawImage(canvas, 0, 0, 64, 64);
  const rgba = context.getImageData(0,0,64,64).data;
  const gray = Array.from({ length: 4096 }, (_, i) => Math.round((rgba[i*4] * .299 + rgba[i*4+1] * .587 + rgba[i*4+2] * .114)));
  // Local edges discard flat highlight colors; square margins are excluded by stability.ts.
  return gray.map((value, i) => (i % 64 === 63 || i >= 4032) ? 0 : Math.min(255, Math.abs(value - gray[i+1]) + Math.abs(value - gray[i+64])));
}
export class BoardCapture {
  private stream: MediaStream | null = null;
  private video = document.createElement('video');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private command: CaptureCommand | null = null;
  private starting = false;
  private frame = 0;
  private samples = 0;
  constructor(private api: ChessHelperAPI) { this.video.muted = true; this.video.playsInline = true; }
  async receive(command: CaptureCommand) {
    if (command.action === 'stop' || !command.selection) { this.stop(); return; }
    const previous = this.command;
    const sameSource = previous?.selection?.sourceId === command.selection.sourceId && JSON.stringify(previous.selection.crop) === JSON.stringify(command.selection.crop);
    this.command = command;
    if (sameSource && (this.stream || this.starting)) return;
    this.stop(); this.command = command; this.starting = true; const epoch = this.epoch;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: 2 } });
      if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; this.video.srcObject = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.fail(epoch));
      await this.video.play(); if (epoch !== this.epoch) return;
      this.starting = false; this.samples = 0; this.tick(epoch);
    } catch { if (epoch === this.epoch) this.fail(epoch); }
  }
  private fail(epoch: number) { const command = this.command; if (epoch !== this.epoch || !command) return; this.stop(); void this.api.captureError({ sessionId: command.sessionId, revision: command.revision, message: 'Capture ended or permission was denied.' }); }
  private tick(epoch: number) {
    if (epoch !== this.epoch || !this.command?.selection || !this.stream) return;
    const started = performance.now();
    const send = async () => {
      const command = this.command!; const selection = command.selection!;
      const width = this.video.videoWidth, height = this.video.videoHeight;
      if (!width || !height || this.video.readyState < 2) return;
      if (this.stream!.getVideoTracks()[0].muted) { this.fail(epoch); return; }
      const crop = selection.crop; const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.min(1024, Math.round(width * crop.width));
      canvas.getContext('2d')!.drawImage(this.video, crop.x*width, crop.y*height, crop.width*width, crop.height*height, 0,0,canvas.width,canvas.height);
      const image = canvas.toDataURL('image/jpeg', .9), signature = boardSignature(canvas);
      // No full-window frame crosses IPC or reaches the cloud; the canvas exists only in memory.
      await this.api.frame({ sessionId: command.sessionId, revision: command.revision, frameId: ++this.frame, image, signature, sourceWidth: width, sourceHeight: height });
      if (epoch === this.epoch && ++this.samples > 120 && command.action === 'sample') this.fail(epoch);
    };
    void send().catch(() => this.fail(epoch)).finally(() => { if (epoch === this.epoch) this.timer = setTimeout(() => this.tick(epoch), Math.max(0, 500 - (performance.now() - started))); });
  }
  stop() { ++this.epoch; if (this.timer) clearTimeout(this.timer); this.timer = null; this.starting = false; this.command = null; this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.video.srcObject = null; }
}
