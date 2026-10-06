import { app, BrowserWindow, ipcMain, session } from "electron";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { allowCapturePermission, denyDisplayCapture } from "../src/main/capture-permission";

const directory = process.argv[2];
const phase = process.argv[3];
assert(directory && ["old", "fixed"].includes(phase));
app.setName("Chess Helper Permission Check");
app.setPath("userData", path.join(directory, `profile-${phase}`));
const html = path.join(directory, "test.html");
const preload = path.join(directory, "preload.cjs");
// This renderer tests permission dispatch only. No desktop source is enumerated
// or granted, no system capture starts, and no screenshot is obtained.
fs.writeFileSync(preload, `const { ipcRenderer } = require("electron");
window.addEventListener("DOMContentLoaded", async () => {
  try { await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    ipcRenderer.send("result", "unexpected-success");
  } catch (error) { ipcRenderer.send("result", error.name); }
});`);
fs.writeFileSync(html, "<!doctype html><meta charset=utf-8><title>Permission dispatch test</title>");
app.whenReady().then(async () => {
  app.dock?.hide();
  const captureSession = session.fromPartition(`permission-check-${phase}`, { cache: false });
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload, session: captureSession },
  });
  let displayHandlerReached = false;
  let sawDisplayMediaRequest = false;
  captureSession.setPermissionCheckHandler(() => false);
  captureSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    if (permission === "media" && mediaTypes?.length === 0) sawDisplayMediaRequest = true;
    callback(phase === "old" ? permission === "display-capture" : allowCapturePermission({
      kind: "request", permission,
      trustedContents: contents === window.webContents,
      sourceSelected: true,
      trustedURL: details.requestingUrl === pathToFileURL(html).href,
      isMainFrame: details.isMainFrame,
      mediaTypes,
    }));
  });
  captureSession.setDisplayMediaRequestHandler((request, callback) => {
    assert.equal(request.frame, window.webContents.mainFrame);
    assert(request.videoRequested && !request.audioRequested);
    displayHandlerReached = true;
    denyDisplayCapture(callback); // Deliberately reject before capturing any pixels.
  });
  const timeout = setTimeout(() => {
    console.error("Permission dispatch check timed out.");
    app.exit(1);
  }, 10000);
  ipcMain.once("result", (event, result) => {
    try {
      assert.equal(event.sender, window.webContents);
      assert.equal(result, phase === "old" ? "NotAllowedError" : "AbortError");
      assert(sawDisplayMediaRequest, "Electron did not send the expected media permission request");
      assert.equal(displayHandlerReached, phase === "fixed");
      console.log(`Electron ${process.versions.electron}: ${phase} policy ${displayHandlerReached ? "reached" : "blocked"} display-source handler as expected.`);
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Permission dispatch check failed");
      app.exit(1);
    }
  });
  await window.loadFile(html);
}).catch(() => app.exit(1));
