import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { NativeWindowCapture } from "../src/main/native-capture";
import type { CaptureSelection } from "../src/shared/contracts";
const selection: CaptureSelection = {
  sessionId: "00000000-0000-4000-8000-000000000001", revision: 0,
  sourceId: "window:421:0", crop: { x: 0.2, y: 0.1, width: 0.4, height: 0.6 },
  sourceWidth: 1600, sourceHeight: 1000, orientation: "white-bottom", coachedSide: "w",
};
let resolve: (value: unknown) => void;
let backend: Mock<() => Promise<unknown>>;
let capture: NativeWindowCapture;
beforeEach(() => {
  vi.useFakeTimers();
  backend = vi.fn(() => new Promise<unknown>(done => { resolve = done; }));
  capture = new NativeWindowCapture("/app/board-capture.node", () => ({ capture: backend }));
});
afterEach(() => vi.useRealTimers());
it("passes only the selected window and crop to the in-process module", async () => {
  const pending = capture.capture(selection);
  await Promise.resolve();
  expect(backend).toHaveBeenCalledExactlyOnceWith({ windowID: 421, crop: selection.crop });
  const frame = { image: "data:image/jpeg;base64,AA==", sourceWidth: 1600, sourceHeight: 1000 };
  resolve(frame);
  await expect(pending).resolves.toEqual(frame);
});
it("rejects screen and malformed IDs before loading native capture", async () => {
  for (const sourceId of ["screen:0:0", "window:0:0", "window:1:0;echo key"])
    await expect(capture.capture({ ...selection, sourceId })).rejects.toMatchObject({ code: "unavailable" });
  expect(backend).not.toHaveBeenCalled();
});
it("bounds concurrent captures and discards an in-flight screenshot after pause", async () => {
  const pending = capture.capture(selection);
  await Promise.resolve();
  await expect(capture.capture(selection)).rejects.toMatchObject({ code: "unavailable" });
  capture.cancel();
  await expect(pending).rejects.toMatchObject({ code: "unavailable" });
  resolve({ image: "late" });
  expect(backend).toHaveBeenCalledOnce();
});
it("resumes immediately after pause without overlapping the old OS screenshot", async () => {
  const paused = capture.capture(selection);
  await Promise.resolve();
  const finishOldShot = resolve;
  capture.cancel();
  await expect(paused).rejects.toMatchObject({ code: "unavailable" });
  const resumed = capture.capture({ ...selection, revision: 1 });
  await Promise.resolve();
  expect(backend).toHaveBeenCalledOnce();
  finishOldShot({ image: "discard this canceled frame" });
  await vi.advanceTimersByTimeAsync(0);
  expect(backend).toHaveBeenCalledTimes(2);
  const fresh = { image: "data:image/jpeg;base64,AA==", sourceWidth: 1600, sourceHeight: 1000 };
  resolve(fresh);
  await expect(resumed).resolves.toEqual(fresh);
});
it("can pause a resumed request while it waits without taking another screenshot", async () => {
  const first = capture.capture(selection);
  await Promise.resolve();
  capture.cancel();
  await expect(first).rejects.toMatchObject({ code: "unavailable" });
  const resumed = capture.capture(selection);
  capture.cancel();
  await expect(resumed).rejects.toMatchObject({ code: "unavailable" });
  resolve({ error: "source-ended" });
  await vi.advanceTimersByTimeAsync(0);
  expect(backend).toHaveBeenCalledOnce();
});
it("bounds a resumed request waiting for an unresponsive canceled screenshot", async () => {
  const first = capture.capture(selection);
  await Promise.resolve();
  capture.cancel();
  await expect(first).rejects.toMatchObject({ code: "unavailable" });
  const resumed = capture.capture(selection);
  const rejection = expect(resumed).rejects.toMatchObject({ code: "unavailable" });
  await vi.advanceTimersByTimeAsync(5000);
  await rejection;
  resolve({ error: "unavailable" });
  await vi.advanceTimersByTimeAsync(0);
  expect(backend).toHaveBeenCalledOnce();
});
it.each(["permission-denied", "source-ended", "unavailable"])("returns a sanitized %s failure", async error => {
  const pending = capture.capture(selection);
  await Promise.resolve(); resolve({ error });
  await expect(pending).rejects.toMatchObject({ code: error, message: "Native board capture unavailable" });
});
it("rejects oversized images and unexpected response fields", async () => {
  const pending = capture.capture(selection);
  await Promise.resolve();
  resolve({ image: "data:image/jpeg;base64," + "A".repeat(4_000_000), sourceWidth: 1600, sourceHeight: 1000, fullWindow: "private" });
  await expect(pending).rejects.toMatchObject({ code: "unavailable" });
});
it("bounds the renderer wait if a native call never returns", async () => {
  const pending = capture.capture(selection);
  const rejection = expect(pending).rejects.toMatchObject({ code: "unavailable" });
  await vi.advanceTimersByTimeAsync(5000); await rejection;
  resolve({ error: "unavailable" });
});
it("does not expose native load/exception details", async () => {
  const broken = new NativeWindowCapture("/app/board-capture.node", () => { throw new Error("private diagnostic"); });
  await expect(broken.capture(selection)).rejects.toMatchObject({ message: "Native board capture unavailable" });
});
