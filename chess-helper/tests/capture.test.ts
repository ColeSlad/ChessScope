import { afterEach, expect, it, vi } from "vitest";
import { BoardCapture } from "../src/renderer/capture";
import { captureFailureMessage } from "../src/core/capture-errors";
import { captureFailureSchema, type CaptureCommand, type ChessHelperAPI } from "../src/shared/contracts";

afterEach(() => vi.unstubAllGlobals());
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
