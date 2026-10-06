import { expect, it } from "vitest";
import { allowCapturePermission } from "../src/main/capture-permission";

const displayRequest = {
  kind: "request" as const,
  permission: "media",
  trustedContents: true,
  sourceSelected: true,
  trustedURL: true,
  isMainFrame: true,
  mediaTypes: [] as string[],
};

it("allows Electron's display-media request to reach the selected-source handler", () => {
  expect(allowCapturePermission(displayRequest)).toBe(true);
  expect(allowCapturePermission({ ...displayRequest, permission: "display-capture" })).toBe(true);
  expect(allowCapturePermission({ ...displayRequest, kind: "check", permission: "display-capture" })).toBe(true);
});

it("blocks camera, microphone, unrelated permissions, and incomplete media details", () => {
  for (const mediaTypes of [["video"], ["audio"], ["video", "audio"], ["unknown"], undefined])
    expect(allowCapturePermission({ ...displayRequest, mediaTypes })).toBe(false);
  expect(allowCapturePermission({ ...displayRequest, kind: "check" })).toBe(false);
  expect(allowCapturePermission({ ...displayRequest, permission: "notifications" })).toBe(false);
});

it("requires a selected source and a trusted top-level capture window", () => {
  for (const permission of ["media", "display-capture"])
    for (const field of ["trustedContents", "sourceSelected", "trustedURL", "isMainFrame"] as const)
      expect(allowCapturePermission({ ...displayRequest, permission, [field]: false })).toBe(false);
});
