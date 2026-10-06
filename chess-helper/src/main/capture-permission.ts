type CapturePermission = {
  kind: "request" | "check";
  permission: string;
  trustedContents: boolean;
  sourceSelected: boolean;
  trustedURL: boolean;
  isMainFrame: boolean;
  mediaTypes?: readonly string[];
};

export function allowCapturePermission(value: CapturePermission): boolean {
  if (
    !value.trustedContents ||
    !value.sourceSelected ||
    !value.trustedURL ||
    !value.isMainFrame
  )
    return false;
  if (value.permission === "display-capture") return true;
  // Electron 42 routes getDisplayMedia through a "media" request first.
  // Hardware capture populates mediaTypes; display capture supplies an empty list.
  // The display-media handler subsequently grants only the selected window's video.
  // Never grant camera/microphone checks or requests with missing/unknown details.
  return (
    value.kind === "request" &&
    value.permission === "media" &&
    Array.isArray(value.mediaTypes) &&
    value.mediaTypes.length === 0
  );
}

export function denyDisplayCapture(callback: (streams: Electron.Streams) => void) {
  // Electron accepts null to decline a source. Its pinned type declaration omits
  // null; an empty object instead throws after consuming the native callback.
  (callback as (streams: Electron.Streams | null) => void)(null);
}
