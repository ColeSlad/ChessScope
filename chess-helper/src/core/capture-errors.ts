import type { CaptureFailureCode } from "../shared/contracts";

export function captureFailureCode(error: unknown): CaptureFailureCode {
  return error instanceof Error && error.name === "NotAllowedError"
    ? "permission-denied"
    : "unavailable";
}

export function captureFailureMessage(permission: string, code: CaptureFailureCode): string {
  if (permission === "restricted")
    return "macOS restricts Screen Recording for this app. Check device restrictions with your administrator. Manual position entry remains available.";
  if (permission === "denied")
    return "macOS Screen Recording permission is denied. Open System Settings → Privacy & Security → Screen & System Audio Recording, enable Chess Helper, then quit and reopen the app.";
  if (code === "permission-denied")
    return "Window capture was denied. Check Chess Helper in Screen Recording Settings, quit and reopen the app, then select the browser window again.";
  if (code === "source-ended")
    return "The selected window stopped sharing. Reopen the browser window if needed and select it again.";
  if (code === "timeout")
    return "The board did not become stable in time. Make sure it is visible and select or rescan it again.";
  if (code === "frame-failed")
    return "The board frame could not be read. Select the browser window again and check the board crop.";
  return "The selected window could not be captured. Make sure it is still open, refresh the window list, and select it again. If this persists, check Screen Recording Settings and restart Chess Helper.";
}
