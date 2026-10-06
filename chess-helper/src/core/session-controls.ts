import type { Snapshot } from "../shared/contracts";

export function sessionIsActive(state: Snapshot): boolean {
  return state.running ||
    state.status.state === "Reading board" ||
    state.status.state === "Analyzing" ||
    state.explanationState === "loading";
}

export function automaticTrackingEnabled(state: Snapshot): boolean {
  return !!state.selection && state.settings.automaticTracking && state.trackingQualified;
}
