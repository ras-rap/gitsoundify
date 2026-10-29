// Spelled once with a fixed mix of sharps and flats so a pitch class always renders the same way.
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** Pitch-class name for any MIDI-style integer, wrapping negatives and values above 11. */
export const noteName = (pitchClass: number) => NOTE_NAMES[((pitchClass % 12) + 12) % 12]!;

/** `m:ss` for a transport position: negatives clamp to zero and fractions are floored so the display never runs ahead. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export { describeSource } from "../compose/source";