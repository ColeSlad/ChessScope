import type { Settings } from "../shared/contracts";

export function solTrackingPreviewAvailable(settings: Settings): boolean {
  return settings.recognition.model === "gpt-6.1-sol" &&
    settings.recognition.effort === "low";
}
