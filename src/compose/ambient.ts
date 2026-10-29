import { bucketCommits, type Slice } from "../extract/bucket";
import type { RepoSnapshot } from "../extract/types";
import { hash32, makeSeed, pathToUnit, Rng } from "./random";
import { degreeToMidi, pathToDegree, pickKey, type Key } from "./scales";
import { normalizeNotes, type NoteEvent, type Score, type SectionMark } from "./score";
import type { NoteSource } from "./source";

const SLICE_TARGET = 256;
const HARMONY_SLICES = 8;
const MAX_ERAS = 8;
const SLICES_PER_ERA = 32;
const CHURN_WINDOW = 4;
const CHURN_DECAY = 0.82;
// Ambient pieces aim for 95-175 seconds; the beat length is back-solved from the chosen tempo.
const TARGET_SECONDS: [number, number] = [95, 175];

// Pad voicing in scale degrees from the chord's root; the last entry is a tension tone that only
// sounds in dense passages. Voice count never exceeds this array's length.
const CHORD = [0, 2, 4, 6, 1] as const;
const MAX_VOICES = CHORD.length;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface AmbientOptions {
  historyWeight?: number;
  bpm?: number;
  key?: Key;
  lengthBeats?: number;
  seedLabel?: string;
}

/**
 * Most-touched top-level directory in a slice, with ties broken alphabetically so the result never
 * depends on object key order. Returns "" when the slice touched no files.
 */
function dominantDir(slice: Slice): string {
  let best = "";
  let bestCount = -1;
  for (const [dir, count] of Object.entries(slice.dirs)) {
    if (count > bestCount || (count === bestCount && dir < best)) {
      best = dir;
      bestCount = count;
    }
  }
  return best;
}


/**
 * Per-slice tension in 0..1: churn (added + removed lines) averaged over a +/-CHURN_WINDOW
 * neighbourhood, normalized against the loudest point, then ratcheted so a value may only fall to
 * CHURN_DECAY of its predecessor. The ratchet keeps tension broad and rolling instead of spiky.
 */
function tensionCurve(slices: Slice[]): number[] {
  const churn = slices.map((s) => s.added + s.removed);

  const smooth = churn.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - CHURN_WINDOW); j <= Math.min(churn.length - 1, i + CHURN_WINDOW); j++) {
      sum += churn[j]!;
      n++;
    }
    return sum / n;
  });

  const max = Math.max(...smooth, 1);
  const out: number[] = [];
  for (let i = 0; i < smooth.length; i++) {
    const raw = smooth[i]! / max;
    out.push(Math.max(raw, i > 0 ? out[i - 1]! * CHURN_DECAY : 0));
  }
  return out;
}

/** One sustained pad chord: `from`/`to` are slice indices (not beats) spanning a harmony block. */
interface HarmonyBlock {
  from: number;
  to: number;
  dir: string;
  pan: number;
  voices: number;
  source: NoteSource;
}

/**
 * Ambient mode: the commit history becomes a drone, evolving pad chords and sparse lead notes. Every
 * tempo, key and length default is seeded from `seedLabel` + repo name, so the result is reproducible;
 * `opts` pins any of them instead (blend mode reuses the structure score's tempo/key/length).
 * `historyWeight` 0..1 thins the texture, and 0 leaves just the drone.
 */
export function composeAmbient(snap: RepoSnapshot, opts: AmbientOptions = {}): Score {
  const weight = clamp(opts.historyWeight ?? 1, 0, 1);
  const seed = makeSeed(snap.name, opts.seedLabel ?? "ambient");
  const rng = new Rng(seed);
  const key = opts.key ?? pickKey(rng);
  const bpm = opts.bpm ?? rng.fork("tempo").int(46, 62);
  const salt = hash32(`${snap.name.trim().toLowerCase()}|ambient`);
  const scaleLen = key.scale.intervals.length;

  const lengthBeats =
    opts.lengthBeats ??
    Math.round((rng.fork("length").int(TARGET_SECONDS[0], TARGET_SECONDS[1]) * bpm) / 60);

  if (snap.commits.length === 0) {
    const notes: NoteEvent[] = [
      { track: "drone", time: 0, duration: lengthBeats, midi: degreeToMidi(key, 0, 2), velocity: 0.45, pan: 0,
        source: { kind: "section", name: "empty", files: 0 } },
    ];
    for (const step of [0, 2, 4]) {
      notes.push({ track: "pad", time: 0, duration: lengthBeats, midi: degreeToMidi(key, step, 3), velocity: 0.3, pan: 0,
        source: { kind: "section", name: "empty", files: 0 } });
    }
    return {
      name: snap.name,
      mode: "ambient",
      seed,
      bpm,
      key: { root: key.root, scale: key.scale.name },
      lengthBeats,
      sections: [{ name: snap.name || "empty", start: 0, length: lengthBeats }],
      notes: normalizeNotes(notes),
    };
  }

  // At most one slice per commit, floored at 8 so very short histories still get a shape.
  const sliceCount = Math.min(SLICE_TARGET, Math.max(8, snap.commits.length));
  const slices = bucketCommits(snap.commits, { slices: sliceCount });
  const sliceBeats = lengthBeats / sliceCount;
  const at = (i: number) => i * sliceBeats;

  const maxNet = Math.max(1, ...slices.map((s) => Math.max(0, s.cumulativeNet)));
  const tension = tensionCurve(slices);

  const authors = new Set<string>();
  for (const s of slices) for (const a of s.authors) authors.add(a);
  const solo = authors.size <= 1;
  // A single-author repo stays centred; otherwise pan comes from the first (sorted) author's hash,
  // so one person keeps a stable position across the whole piece.
  const panFor = (list: string[]): number =>
    solo || list.length === 0 ? 0 : pathToUnit(list[0]!, salt) * 2 - 1;

  const eraCount = Math.min(MAX_ERAS, Math.max(1, Math.round(sliceCount / SLICES_PER_ERA)));
  const eraBounds = Array.from({ length: eraCount + 1 }, (_, e) => Math.floor((e * sliceCount) / eraCount));

  const sections: SectionMark[] = [];
  let cursor = 0; 
  for (let e = 0; e < eraCount; e++) {
    const from = eraBounds[e]!;
    const to = eraBounds[e + 1]!;
    const tally = new Map<string, number>();
    for (let i = from; i < to; i++) {
      const dir = dominantDir(slices[i]!);
      if (dir) tally.set(dir, (tally.get(dir) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const length = at(to) - at(from);
    sections.push({ name: top ?? `era ${e + 1}`, start: cursor, length });
    cursor += length;
  }

  const notes: NoteEvent[] = [];

  notes.push({
    track: "drone",
    time: 0,
    duration: lengthBeats,
    midi: degreeToMidi(key, 0, 2),
    velocity: 0.45,
    pan: 0,
    source: { kind: "section", name: "history", files: snap.tree.fileCount },
  });

  const blocks: HarmonyBlock[] = [];
  for (let from = 0; from < sliceCount; from += HARMONY_SLICES) {
    const to = Math.min(sliceCount, from + HARMONY_SLICES);
    const members = slices.slice(from, to);
    const filled = members.filter((s) => s.commitCount > 0);
    if (filled.length === 0) continue; 

    const dir = dominantDir(filled.reduce<Slice>((a, b) => (b.filesChanged > a.filesChanged ? b : a), filled[0]!));

    const avgNet = members.reduce((n, s) => n + s.cumulativeNet, 0) / members.length;
    const size = Math.log2(1 + Math.max(0, avgNet)) / Math.log2(1 + maxNet);
    const added = members.reduce((n, s) => n + s.added, 0);
    const removed = members.reduce((n, s) => n + s.removed, 0);
    // Chord size follows average cumulative line count relative to the repo's peak, and a block that
    // deletes more than it adds is thinned.
    const density = clamp(0.25 + 0.75 * size, 0, 1) * (removed > added ? 0.7 : 1);

    const t = Math.max(...members.map((_, i) => tension[from + i] ?? 0));
    const base = 1 + Math.round(2 * density);
    const extra = t > 0.8 ? 2 : t > 0.55 ? 1 : 0;

    const scaled = Math.round((base + extra) * weight);
    const voices = clamp(scaled, weight > 0 ? 1 : 0, MAX_VOICES);

    const blockAuthors = [...new Set(filled.flatMap((s) => s.authors))].sort();
    const hash = filled.find((s) => s.hashes.length > 0)?.hashes[0];

    blocks.push({
      from,
      to,
      dir,
      pan: panFor(blockAuthors),
      voices,
      source: {
        kind: "slice",
        index: from,
        dir: dir || "(root)",
        commits: members.reduce((n, s) => n + s.commitCount, 0),
        hash,
        from: members.find((s) => s.firstTime !== null)?.firstTime ?? undefined,
        to: [...members].reverse().find((s) => s.lastTime !== null)?.lastTime ?? undefined,
      },
    });
  }

  const sustained = new Map<string, NoteEvent>();

  for (const b of blocks) {
    const start = at(b.from);
    const duration = at(b.to) - at(b.from);
    // Shift the whole chord by 0, 2 or 4 degrees per directory so consecutive blocks do not all sit
    // on the tonic.
    const dirShift = [0, 2, 4][hash32(b.dir) % 3]!;

    for (let v = 0; v < b.voices; v++) {
      const midi = degreeToMidi(key, CHORD[v]! + dirShift, 3);
      const voiceId = `${midi}:${b.pan.toFixed(4)}`;
      const prev = sustained.get(voiceId);

      // If the previous block ended exactly where this one starts, hold its note instead of starting a
      // new one: a steady chord should read as one long note, not a run of touching ones.
      if (prev && Math.abs(prev.time + prev.duration - start) < 1e-9) {
        prev.duration += duration; 
        continue;
      }

      const note: NoteEvent = {
        track: "pad",
        time: start,
        duration,
        midi,
        velocity: 0.3,
        pan: b.pan,
        source: b.source,
      };
      sustained.set(voiceId, note);
      notes.push(note);
    }
  }

  for (let i = 0; i < sliceCount; i++) {
    const s = slices[i]!;
    if (s.commitCount === 0) continue;

    const start = at(i);
    const dir = dominantDir(s);
    const pan = panFor(s.authors);
    const filePath = s.paths[0];

    if (!rng.chance(0.35 * weight)) continue;

    const degree = pathToDegree(filePath ?? `${dir}/${i}`, scaleLen * 2, salt);
    const duration = Math.min(Math.max(sliceBeats * 2, 0.5), 6, lengthBeats - start);
    if (duration <= 0.1) continue;

    notes.push({
      track: "lead",
      time: start,
      duration,
      midi: degreeToMidi(key, degree, 5),
      velocity: 0.55,
      pan,
      source: filePath
        ? { kind: "file", path: filePath, hash: s.hashes[0] }
        : { kind: "slice", index: i, dir: dir || "(root)", commits: s.commitCount, hash: s.hashes[0] },
    });
  }

  return {
    name: snap.name,
    mode: "ambient",
    seed,
    bpm,
    key: { root: key.root, scale: key.scale.name },
    lengthBeats,
    sections,
    notes: normalizeNotes(notes),
  };
}