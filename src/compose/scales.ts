import { hashPath, type Rng } from "./random";

export interface Scale {
  name: string;
  /** Semitone offsets from the root, ascending and starting at 0; length defines the octave span. */
  intervals: readonly number[];
}

// Order is part of the seed contract: pickKey indexes into this array, so inserting a scale
// reshuffles every previously generated score.
export const SCALES: readonly Scale[] = [
  { name: "minor pentatonic", intervals: [0, 3, 5, 7, 10] },
  { name: "major pentatonic", intervals: [0, 2, 4, 7, 9] },
  { name: "dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: "lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: "aeolian", intervals: [0, 2, 3, 5, 7, 8, 10] },
];

export interface Key {
  root: number;
  scale: Scale;
}

/** Root is a pitch class 0-11. Forked so the caller's stream position does not shift the key. */
export function pickKey(rng: Rng): Key {
  const r = rng.fork("key");
  return { root: r.int(0, 11), scale: r.pick(SCALES) };
}


/**
 * `degree` counts scale steps, not semitones; negative values and values past the top of the scale
 * wrap cleanly into adjacent octaves. `octave` 4 puts a C root at MIDI 60. Result is clamped to
 * 0-127 so hash-derived degrees can never produce an unplayable pitch.
 */
export function degreeToMidi(key: Key, degree: number, octave = 4): number {
  const len = key.scale.intervals.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  const midi = 12 * (octave + 1) + key.root + key.scale.intervals[idx]! + 12 * oct;
  return Math.max(0, Math.min(127, midi));
}


/** Hash a path into a degree in [0, span), so a file always lands on the same scale step. */
export function pathToDegree(path: string, span: number, salt: number | string = 0): number {
  return hashPath(path, salt) % span;
}