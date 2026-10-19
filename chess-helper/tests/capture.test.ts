import { afterEach, expect, it, vi } from "vitest";
import { BoardCapture } from "../src/renderer/capture";
import { captureFailureMessage } from "../src/core/capture-errors";
import { captureFailureSchema, frameSchema, type CaptureCommand, type ChessHelperAPI, type NativeCaptureResult } from "../src/shared/contracts";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const command: CaptureCommand = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  revision: 4,
  action: "sample",
  selection: {
    sessionId: "00000000-0000-4000-8000-000000000001",
    revision: 4,
    sourceId: "window:1:0",
    crop: { x: 0, y: 0, width: 1, height: 1 },
    sourceWidth: 800, sourceHeight: 800,
    orientation: "white-bottom", coachedSide: "w",
  },
};

it("reports capture permission denial with the active revision and no frame upload", async () => {
  vi.stubGlobal("document", { createElement: () => ({ srcObject: null }) });
  vi.stubGlobal("navigator", { mediaDevices: {
    getDisplayMedia: vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")),
  } });
  const captureError = vi.fn().mockResolvedValue(undefined);
  const frame = vi.fn();
  const capture = new BoardCapture({ captureError, frame } as unknown as ChessHelperAPI);
  await capture.receive(command);
  expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledExactlyOnceWith({
    audio: false, video: { frameRate: 2, cursor: "never" },
  });
  expect(captureError).toHaveBeenCalledExactlyOnceWith({
    sessionId: command.sessionId, revision: command.revision, code: "permission-denied",
  });
  expect(frame).not.toHaveBeenCalled();
});

it("discards a pending capture failure after pause", async () => {
  vi.stubGlobal("document", { createElement: () => ({ srcObject: null }) });
  let reject!: (error: Error) => void;
  vi.stubGlobal("navigator", { mediaDevices: {
    getDisplayMedia: () => new Promise((_resolve, fail) => { reject = fail; }),
  } });
  const captureError = vi.fn().mockResolvedValue(undefined);
  const capture = new BoardCapture({ captureError } as unknown as ChessHelperAPI);
  const pending = capture.receive(command);
  capture.stop();
  reject(new DOMException("Permission denied", "NotAllowedError"));
  await pending;
  expect(captureError).not.toHaveBeenCalled();
});

it("distinguishes denied macOS authorization, restrictions, and a closed capture source", () => {
  const denied = captureFailureMessage("denied", "unavailable");
  expect(denied).toContain("Screen & System Audio Recording");
  expect(denied).toContain("quit and reopen");
  expect(captureFailureMessage("restricted", "permission-denied")).toContain("administrator");
  expect(captureFailureMessage("granted", "source-ended")).toContain("stopped sharing");
  expect(captureFailureSchema.safeParse({ sessionId: command.sessionId, revision: command.revision, code: "untrusted-error" }).success).toBe(false);
});

it("submits only the native board crop and current token, without starting display video", async () => {
  const context = { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) };
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => context, srcObject: null }) });
  vi.stubGlobal("Image", class { naturalWidth = 64; src = ""; async decode() {} });
  const getDisplayMedia = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });
  const board = { image: "data:image/jpeg;base64,AA==", sourceWidth: 800, sourceHeight: 800 };
  const nativeFrame = vi.fn().mockResolvedValue({ frame: board });
  const frame = vi.fn().mockResolvedValue(undefined);
  const capture = new BoardCapture({ nativeFrame, frame } as unknown as ChessHelperAPI);
  await capture.receive(command);
  await vi.waitFor(() => expect(frame).toHaveBeenCalledOnce());
  capture.stop();
  expect(nativeFrame).toHaveBeenCalledExactlyOnceWith({ sessionId: command.sessionId, revision: command.revision });
  expect(frameSchema.parse(frame.mock.calls[0][0])).toMatchObject({ ...board, frameId: 1 });
  expect(getDisplayMedia).not.toHaveBeenCalled();
});

it("discards a native capture response arriving after pause", async () => {
  vi.stubGlobal("document", { createElement: () => ({ srcObject: null }) });
  let resolve!: (value: NativeCaptureResult) => void;
  const nativeFrame = vi.fn(() => new Promise<NativeCaptureResult>(done => { resolve = done; }));
  const frame = vi.fn();
  const captureError = vi.fn();
  const capture = new BoardCapture({ nativeFrame, frame, captureError } as unknown as ChessHelperAPI);
  await capture.receive(command);
  capture.stop();
  resolve({ error: "source-ended" });
  await Promise.resolve();
  expect(frame).not.toHaveBeenCalled();
  expect(captureError).not.toHaveBeenCalled();
});

it.each(["error", "reject", "frame"] as const)("discards an old native %s after a newer scan revision", async outcome => {
  vi.useFakeTimers();
  const context = { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) };
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => context, srcObject: null }) });
  vi.stubGlobal("Image", class { naturalWidth = 64; src = ""; async decode() {} });
  let finish!: (value: NativeCaptureResult) => void;
  let fail!: (error: Error) => void;
  const board = { image: "data:image/jpeg;base64,AA==", sourceWidth: 800, sourceHeight: 800 };
  const nativeFrame = vi.fn().mockImplementationOnce(() => new Promise<NativeCaptureResult>((resolve, reject) => { finish = resolve; fail = reject; }))
    .mockResolvedValue({ frame: board });
  const frame = vi.fn().mockResolvedValue(undefined);
  const captureError = vi.fn().mockResolvedValue(undefined);
  const capture = new BoardCapture({ nativeFrame, frame, captureError } as unknown as ChessHelperAPI);
  await capture.receive(command);
  const rescan = { ...command, revision: command.revision + 1 };
  await capture.receive(rescan);
  if (outcome === "error") finish({ error: "unavailable" });
  else if (outcome === "frame") finish({ frame: { ...board, image: "data:image/jpeg;base64,b2xk" } });
  else fail(new Error("Request belongs to the old position"));
  await vi.advanceTimersByTimeAsync(500);
  expect(captureError).not.toHaveBeenCalled();
  expect(frame).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ revision: rescan.revision, image: board.image }));
  capture.stop();
});
