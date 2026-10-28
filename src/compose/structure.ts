import type { RepoSnapshot, TreeNode } from "../extract/types";
import { hash32, makeSeed, Rng } from "./random";
import { degreeToMidi, pathToDegree, pickKey } from "./scales";
import { normalizeNotes, type NoteEvent, type Score, type SectionMark } from "./score";

const BEATS_PER_BAR = 4;
const MAX_TOTAL_BEATS = 160;
const MAX_SECTIONS = 10;
const MIN_SECTION_BEATS = 8;
const MAX_SECTION_BEATS = 64;
const CODA_BEATS = 8;
const ROOT_SECTION = "(root)";

interface FileInfo {
  path: string;
  size: number;
  depth: number;
}

interface SectionPlan {
  name: string;
  files: FileInfo[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const roundToBar = (beats: number) => Math.round(beats / BEATS_PER_BAR) * BEATS_PER_BAR;

function collectFiles(node: TreeNode, out: FileInfo[]): void {
  if (node.type === "file") {
    out.push({ path: node.path, size: node.size, depth: node.path.split("/").length - 1 });
    return;
  }
  for (const child of node.children ?? []) collectFiles(child, out);
}

function planSections(tree: TreeNode): SectionPlan[] {
  const rootFiles: FileInfo[] = [];
  let dirs: SectionPlan[] = [];

  for (const child of tree.children ?? []) {
    if (child.type === "file") {
      rootFiles.push({ path: child.path, size: child.size, depth: 0 });
    } else {
      const files: FileInfo[] = [];
      collectFiles(child, files);
      if (files.length > 0) dirs.push({ name: child.name, files });
    }
  }

  const limit = MAX_SECTIONS - (rootFiles.length > 0 ? 1 : 0);
  if (dirs.length > limit) {
    dirs = dirs
      .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name))
      .slice(0, limit)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return rootFiles.length > 0 ? [{ name: ROOT_SECTION, files: rootFiles }, ...dirs] : dirs;
}

function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);
}

function allocateBeats(plans: SectionPlan[]): number[] {
  const budget = Math.min(MAX_TOTAL_BEATS, 32 + 24 * plans.length);
  const weights = plans.map((p) => Math.log2(1 + p.files.length));
  const total = weights.reduce((a, b) => a + b, 0);

  return plans.map((p, i) => {
    const share = (budget * weights[i]!) / total;
    const cap = Math.min(MAX_SECTION_BEATS, MIN_SECTION_BEATS + 4 * p.files.length);
    return Math.max(MIN_SECTION_BEATS, roundToBar(clamp(share, MIN_SECTION_BEATS, cap)));
  });
}

export function composeStructure(snap: RepoSnapshot): Score {
  const seed = makeSeed(snap.name, "structure");
  const rng = new Rng(seed);
  const key = pickKey(rng);
  const bpm = rng.fork("tempo").int(54, 70);
  const salt = hash32(snap.name.trim().toLowerCase());
  const scaleLen = key.scale.intervals.length;

  const plans = planSections(snap.tree);
  const beats = allocateBeats(plans);

  const notes: NoteEvent[] = [];
  const sections: SectionMark[] = [];
  let cursor = 0;

  plans.forEach((plan, si) => {
    const start = cursor;
    const len = beats[si]!;
    sections.push({ name: plan.name, start, length: len });

    const sectionDegree = si === 0 ? 0 : pathToDegree(plan.name, scaleLen, salt);

    notes.push({ track: "drone", time: start, duration: len, midi: degreeToMidi(key, sectionDegree, 2), velocity: 0.5 });

    const padRng = rng.fork(`pad:${plan.name}`);
    for (let k = 0; k * 8 < len; k++) {
      const blockLen = Math.min(8, len - k * 8);
      const d = sectionDegree + (k % 2 === 0 ? 0 : padRng.pick([-2, 2, 3]));
      for (const step of [0, 2, 4]) {
        notes.push({ track: "pad", time: start + k * 8, duration: blockLen, midi: degreeToMidi(key, d + step, 3), velocity: 0.34 });
      }
    }

    let offset = 0;
    if (plan.name === ROOT_SECTION && snap.readme) {
      const words = snap.readme.firstLine.split(/\s+/).filter(Boolean).slice(0, clamp(len - 6, 0, 6));
      words.forEach((w, i) => {
        const deg = pathToDegree(w.toLowerCase(), scaleLen * 2, salt);
        notes.push({ track: "lead", time: start + i, duration: 1.5, midi: degreeToMidi(key, deg, 5), velocity: 0.6 });
      });
      if (words.length > 0) offset = words.length + 1;
    }

    const avail = len - offset - 1;
    const picks = sample(plan.files, Math.max(0, Math.floor(avail)));
    const step = picks.length > 0 ? avail / picks.length : 0;

    picks.forEach((f, i) => {
      const time = start + offset + Math.round(i * step * 2) / 2; // snap to half-beats
      const deg = pathToDegree(f.path, scaleLen * 2, salt);
      const octave = clamp(5 - f.depth, 3, 5);
      const sizeBits = Math.log2(f.size + 1);
      const duration = Math.min(clamp(0.5 + (sizeBits - 6) * 0.5, 0.5, 6), start + len - time);
      const velocity = clamp(0.7 - 0.1 * f.depth + Math.min(0.1, sizeBits / 200), 0.3, 0.85);
      notes.push({ track: "lead", time, duration, midi: degreeToMidi(key, deg, octave), velocity });
    });

    cursor += len;
  });

  sections.push({ name: "coda", start: cursor, length: CODA_BEATS });
  notes.push({ track: "drone", time: cursor, duration: CODA_BEATS, midi: degreeToMidi(key, 0, 2), velocity: 0.5 });
  for (const step of [0, 2, 4]) {
    notes.push({ track: "pad", time: cursor, duration: CODA_BEATS, midi: degreeToMidi(key, step, 3), velocity: 0.34 });
  }
  notes.push({ track: "lead", time: cursor, duration: CODA_BEATS, midi: degreeToMidi(key, 0, 4), velocity: 0.5 });
  cursor += CODA_BEATS;

  return {
    name: snap.name,
    mode: "structure",
    seed,
    bpm,
    key: { root: key.root, scale: key.scale.name },
    lengthBeats: cursor,
    sections,
    notes: normalizeNotes(notes),
  };
}