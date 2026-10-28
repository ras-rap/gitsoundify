export type TrackId = "drone" | "pad" | "lead";
export const TRACKS: readonly TrackId[] = ["drone", "pad", "lead"];

export interface NoteEvent {
  track: TrackId;
  time: number;
  duration: number;
  midi: number;
  velocity: number;
}

export interface SectionMark {
  name: string;
  start: number;
  length: number;
}

export interface Score {
  name: string;
  mode: "structure" | "ambient";
  seed: number;
  bpm: number;
  key: { root: number; scale: string };
  lengthBeats: number;
  sections: SectionMark[];
  notes: NoteEvent[];
}

export function scoreSeconds(score: Score): number {
  return (score.lengthBeats * 60) / score.bpm;
}

export function normalizeNotes(notes: NoteEvent[]): NoteEvent[] {
  const sorted = notes
    .map((n) => ({ ...n }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi || a.track.localeCompare(b.track));

  const lastByVoice = new Map<string, NoteEvent>();
  const out: NoteEvent[] = [];

  for (const n of sorted) {
    const voice = `${n.track}:${n.midi}`;
    const prev = lastByVoice.get(voice);

    if (prev && prev.time === n.time) {
      prev.duration = Math.max(prev.duration, n.duration);
      prev.velocity = Math.max(prev.velocity, n.velocity);
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