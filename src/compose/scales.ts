import { hashPath, type Rng } from "./random";

export interface Scale {
  name: string;
  intervals: readonly number[];
}

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

export function pickKey(rng: Rng): Key {
  const r = rng.fork("key");
  return { root: r.int(0, 11), scale: r.pick(SCALES) };
}


export function degreeToMidi(key: Key, degree: number, octave = 4): number {
  const len = key.scale.intervals.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  const midi = 12 * (octave + 1) + key.root + key.scale.intervals[idx]! + 12 * oct;
  return Math.max(0, Math.min(127, midi));
}


export function pathToDegree(path: string, span: number, salt: number | string = 0): number {
  return hashPath(path, salt) % span;
}