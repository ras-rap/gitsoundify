import type { RepoSnapshot } from "../extract/types";
import { composeAmbient, type AmbientOptions } from "./ambient";
import { SCALES } from "./scales";
import { normalizeNotes, type Mode, type Score } from "./score";
import { composeStructure } from "./structure";

export { scoreSeconds, TRACKS, type Mode, type NoteEvent, type Score, type SectionMark, type TrackId } from "./score";
export { composeAmbient, composeStructure };
export type { AmbientOptions };

export const STRUCTURE_MAX = 15;
export const AMBIENT_MIN = 50;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function selectMode(commitCount: number): Mode {
  if (commitCount < STRUCTURE_MAX) return "structure";
  if (commitCount <= AMBIENT_MIN) return "blend";
  return "ambient";
}

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

export function composeBlend(snap: RepoSnapshot): Score {
  return blendWith(snap, (snap.commitCount - STRUCTURE_MAX) / (AMBIENT_MIN - STRUCTURE_MAX));
}

export function compose(snap: RepoSnapshot, mode: Mode, opts: AmbientOptions = {}): Score {
  if (mode === "structure") return composeStructure(snap);
  if (mode === "ambient") return composeAmbient(snap, opts);
  return blendWith(snap, opts.historyWeight ?? (snap.commitCount - STRUCTURE_MAX) / (AMBIENT_MIN - STRUCTURE_MAX));
}