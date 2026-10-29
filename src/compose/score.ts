export type TrackId = "drone" | "pad" | "lead";
// Voice roles: drone holds one long bed note, pad supplies chords, lead carries one note per
// file or commit. The order fixes MIDI channel/track assignment in the renderer.
export const TRACKS: readonly TrackId[] = ["drone", "pad", "lead"];

export type Mode = "structure" | "ambient" | "blend";
import type { NoteSource } from "./source";

export type { NoteSource };

/**
 * One sounding note. `time` and `duration` are in beats (multiply by 60/bpm for seconds), `midi` is
 * a pitch 0-127, `pan` is -1..1 and defaults to centre, and `source` is the provenance shown in the
 * hover tooltip.
 */
export interface NoteEvent {
  track: TrackId;
  time: number;
  duration: number;
  midi: number;
  velocity: number;
  pan?: number;
  source?: NoteSource;
}

export interface SectionMark {
  name: string;
  start: number;
  length: number;
}

/**
 * Everything the renderer and the synth need, with no back-reference to the repo it came from.
 * `key.scale` is stored as a name rather than the interval table so a score survives JSON round-trips;
 * `lengthBeats` is authoritative for the piece's length, including any appended coda.
 */
export interface Score {
  name: string;
  mode: Mode;
  seed: number;
  bpm: number;
  key: { root: number; scale: string };
  lengthBeats: number;
  sections: SectionMark[];
  notes: NoteEvent[];
}

/** Total playing time in seconds at the score's own tempo. */
export function scoreSeconds(score: Score): number {
  return (score.lengthBeats * 60) / score.bpm;
}

/**
 * Canonical form of a score's note list: sorted by time, then pitch, then track name (so the roll
 * paints in a fixed order), with same-voice collisions resolved. Two notes share a voice when
 * track, pitch and pan match.
 *
 * A duplicate at the same time is folded into one note; a note that starts before the previous one
 * in its voice ends is truncated to remove the overlap. Input is not mutated — notes are cloned.
 */
export function normalizeNotes(notes: NoteEvent[]): NoteEvent[] {
  const sorted = notes
    .map((n) => ({ ...n }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi || a.track.localeCompare(b.track));

  const lastByVoice = new Map<string, NoteEvent>();
  const out: NoteEvent[] = [];

  for (const n of sorted) {
    const voice = `${n.track}:${n.midi}:${(n.pan ?? 0).toFixed(4)}`;
    const prev = lastByVoice.get(voice);

    if (prev && prev.time === n.time) {
      prev.duration = Math.max(prev.duration, n.duration);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      prev.source ??= n.source;
      continue;
    }
    if (prev && prev.time + prev.duration > n.time) {
      prev.duration = n.time - prev.time;
    }
    lastByVoice.set(voice, n);
    out.push(n);
  }
  return out;
}

