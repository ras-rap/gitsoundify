import type { TrackId } from "../compose/score";

/** Shared track hues. The roll uses flatter alpha so overlapping chords don't read as one block. */
export const TRACK_COLOR: Record<TrackId, string> = {
  drone: "rgba(99, 102, 241, 0.9)",
  pad: "rgba(167, 139, 250, 0.6)",
  lead: "rgba(251, 191, 36, 0.95)",
};

export const ROLL_COLOR: Record<TrackId, string> = {
  ...TRACK_COLOR,
  pad: "rgba(167, 139, 250, 0.35)",
};