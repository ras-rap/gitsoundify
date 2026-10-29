import type { RepoSnapshot } from "../extract/types";
import { composeAmbient, type AmbientOptions } from "./ambient";
import { SCALES } from "./scales";
import { normalizeNotes, type Mode, type Score } from "./score";
import { composeStructure } from "./structure";

export { scoreSeconds, TRACKS, type Mode, type NoteEvent, type Score, type SectionMark, type TrackId } from "./score";
export { composeAmbient, composeStructure };
export type { AmbientOptions };

// Commit-count window for mode selection: below STRUCTURE_MAX the tree is too coarse to need
// ambient density, above AMBIENT_MIN there is too much history to pin to a folder structure.
export const STRUCTURE_MAX = 15;
export const AMBIENT_MIN = 50;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Thresholds are inclusive at the top end: exactly STRUCTURE_MAX or AMBIENT_MIN still blends. */
export function selectMode(commitCount: number): Mode {
  if (commitCount < STRUCTURE_MAX) return "structure";
  if (commitCount <= AMBIENT_MIN) return "blend";
  return "ambient";
}

/**
 * Overlays the two composers on one timeline. Structure supplies the skeleton (sections, tempo,
 * key, length); ambient adds only its pads and leads — its drone is dropped so the two beds do not
 * fight. `historyWeight` is clamped to 0..1 and scales how dense the ambient layer is.
 */
export function blendWith(snap: RepoSnapshot, historyWeight: number): Score {
  const structure = composeStructure(snap);
  const scale = SCALES.find((s) => s.name === structure.key.scale) ?? SCALES[0]!;

  const ambient = composeAmbient(snap, {
    historyWeight: clamp(historyWeight, 0, 1),
    bpm: structure.bpm,
    key: { root: structure.key.root, scale },
    lengthBeats: structure.lengthBeats,
    seedLabel: "blend",
  });

  const notes = [...structure.notes, ...ambient.notes.filter((n) => n.track !== "drone")];

  return {
    name: snap.name,
    mode: "blend",
    seed: ambient.seed,
    bpm: structure.bpm,
    key: structure.key,
    lengthBeats: structure.lengthBeats,
    sections: structure.sections,
    notes: normalizeNotes(notes),
  };
}

/** Weight ramps 0 -> 1 across STRUCTURE_MAX..AMBIENT_MIN, so mode changes are gradual, not abrupt. */
export function composeBlend(snap: RepoSnapshot): Score {
  return blendWith(snap, (snap.commitCount - STRUCTURE_MAX) / (AMBIENT_MIN - STRUCTURE_MAX));
}

/** Single entry point; `blend` honours an explicit historyWeight before falling back to the ramp. */
export function compose(snap: RepoSnapshot, mode: Mode, opts: AmbientOptions = {}): Score {
  if (mode === "structure") return composeStructure(snap);
  if (mode === "ambient") return composeAmbient(snap, opts);
  return blendWith(snap, opts.historyWeight ?? (snap.commitCount - STRUCTURE_MAX) / (AMBIENT_MIN - STRUCTURE_MAX));
}