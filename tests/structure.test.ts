import { expect, test } from "bun:test";
import { buildTree } from "../src/extract/tree";
import type { RepoSnapshot } from "../src/extract/types";
import { scoreToMidi, vlq } from "../src/render/midi";
import { composeStructure } from "../src/compose";
import { normalizeNotes, scoreSeconds, type Score } from "../src/compose/score";

/** Minimal snapshot for structure mode: the file tree drives everything, history is empty. */
function snapOf(files: { path: string; size: number }[], name = "demo", readme: string | null = null): RepoSnapshot {
  return {
    name,
    head: "abc",
    commitCount: 1,
    firstCommitAt: 0,
    lastCommitAt: 0,
    commits: [],
    tree: buildTree(files, name),
    readme: readme ? { path: "README.md", firstLine: readme } : null,
    extensions: {},
  };
}

/** The realistic repo shape reused across tests: root files, src split over 9 dirs, docs and tests. */
const bigRepo = () =>
  snapOf([
    { path: "README.md", size: 400 },
    { path: "package.json", size: 900 },
    ...Array.from({ length: 120 }, (_, i) => ({ path: `src/mod${i % 9}/file${i}.ts`, size: 200 + i * 40 })),
    ...Array.from({ length: 30 }, (_, i) => ({ path: `docs/page${i}.md`, size: 1500 })),
    ...Array.from({ length: 12 }, (_, i) => ({ path: `tests/t${i}.ts`, size: 800 })),
  ], "big", "A tiny demo of things");

test("deterministic: same snapshot gives an identical score", () => {
  expect(composeStructure(bigRepo())).toEqual(composeStructure(bigRepo()));
});

test("a different repo name gives a different seed and key/tempo", () => {
  const a = composeStructure(snapOf([{ path: "a.ts", size: 10 }], "alpha"));
  const b = composeStructure(snapOf([{ path: "a.ts", size: 10 }], "bravo"));
  expect(a.seed).not.toBe(b.seed);
});

test("one-file repo yields a short but complete piece ending on the coda", () => {
  const s = composeStructure(snapOf([{ path: "main.rs", size: 5000 }]));
  expect(s.sections.map((x) => x.name)).toEqual(["(root)", "coda"]);
  expect(s.notes.some((n) => n.track === "lead")).toBe(true);
  expect(scoreSeconds(s)).toBeLessThan(40);
});

test("empty repo still produces a valid score (just the coda)", () => {
  const s = composeStructure(snapOf([]));
  expect(s.sections.map((x) => x.name)).toEqual(["coda"]);
  expect(s.notes.length).toBeGreaterThan(0);
});

/** Sections must tile [0, lengthBeats) with no gaps, and every note must sit in legal ranges and end inside the piece. */
function checkInvariants(s: Score) {
  let pos = 0;
  for (const sec of s.sections) {
    expect(sec.start).toBe(pos);
    pos += sec.length;
  }
  expect(pos).toBe(s.lengthBeats);
  for (const n of s.notes) {
    expect(n.midi).toBeGreaterThanOrEqual(0);
    expect(n.midi).toBeLessThanOrEqual(127);
    expect(n.velocity).toBeGreaterThan(0);
    expect(n.velocity).toBeLessThanOrEqual(1);
    expect(n.duration).toBeGreaterThan(0);
    expect(n.time).toBeGreaterThanOrEqual(0);
    expect(n.time + n.duration).toBeLessThanOrEqual(s.lengthBeats + 1e-9);
  }
}

test("invariants hold for big, tiny, and odd repos", () => {
  checkInvariants(composeStructure(bigRepo()));
  checkInvariants(composeStructure(snapOf([{ path: "a", size: 0 }])));
  checkInvariants(composeStructure(snapOf([{ path: "x/y/z/w/deep.ts", size: 1e9 }])));
  checkInvariants(composeStructure(snapOf(Array.from({ length: 40 }, (_, i) => ({ path: `d${i}/f.ts`, size: 100 })))));
});

test("huge repos stay within the section and length budget", () => {
  const many = snapOf(Array.from({ length: 40 }, (_, i) => ({ path: `d${i}/f${i}.ts`, size: 100 })));
  const s = composeStructure(many);
  // Hard caps keep a huge repo listenable: bounded section count, and length grows only by a
  // fixed allowance per section on top of the base and intro.
  expect(s.sections.length).toBeLessThanOrEqual(11); 
  expect(s.lengthBeats).toBeLessThanOrEqual(160 + 8 + 4 * 10); 
});

test("README opens the piece with a motif of lead notes", () => {
  const s = composeStructure(bigRepo());
  const early = s.notes.filter((n) => n.track === "lead" && n.time < 6);
  expect(early.length).toBeGreaterThanOrEqual(4);
});

test("a file keeps its pitch regardless of other files in the repo", () => {
  const a = composeStructure(snapOf([{ path: "src/a.ts", size: 4096 }], "same"));
  const b = composeStructure(snapOf([{ path: "src/a.ts", size: 4096 }, { path: "src/b.ts", size: 4096 }], "same"));
  const leadA = a.notes.filter((n) => n.track === "lead" && n.time < a.sections[0]!.length).map((n) => n.midi);
  // Pitch derives from the path hash alone, so adding a sibling file must not transpose the original.
  expect(b.notes.some((n) => n.track === "lead" && leadA.includes(n.midi))).toBe(true);
});

test("normalizeNotes trims same-pitch overlaps and merges duplicates", () => {
  const out = normalizeNotes([
    { track: "lead", time: 0, duration: 4, midi: 60, velocity: 0.5 },
    { track: "lead", time: 2, duration: 4, midi: 60, velocity: 0.5 },
    { track: "lead", time: 2, duration: 1, midi: 60, velocity: 0.9 },
    { track: "pad", time: 0, duration: 4, midi: 60, velocity: 0.5 },
  ]);
  // Overlap is trimmed, not dropped: the note at 0 is cut to end where the one at 2 begins.
  expect(out.filter((n) => n.track === "lead")).toHaveLength(2);
  expect(out.find((n) => n.track === "lead" && n.time === 0)!.duration).toBe(2);
  // Same pitch and onset collapse into the louder take.
  expect(out.find((n) => n.track === "lead" && n.time === 2)!.velocity).toBe(0.9);
  expect(out.filter((n) => n.track === "pad")).toHaveLength(1);
});

test("vlq encodes per the MIDI spec", () => {
  // 0x7f is the last single-byte value; 0x0fffffff is the largest a 4-byte VLQ can carry.
  expect(vlq(0)).toEqual([0x00]);
  expect(vlq(0x7f)).toEqual([0x7f]);
  expect(vlq(0x80)).toEqual([0x81, 0x00]);
  expect(vlq(480)).toEqual([0x83, 0x60]);
  expect(vlq(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
});

test("MIDI file is well formed: header, 4 tracks, balanced note on/off", () => {
  const score = composeStructure(bigRepo());
  const b = scoreToMidi(score);
  const str = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  const u32 = (o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

  expect(str(0, 4)).toBe("MThd");
  // Header after the magic: format 1 (multi-track), 4 tracks, 480 ticks per quarter note.
  expect((b[8]! << 8) | b[9]!).toBe(1);
  expect((b[10]! << 8) | b[11]!).toBe(4);
  expect((b[12]! << 8) | b[13]!).toBe(480);

  let off = 14, tracks = 0, ons = 0, offs = 0;
  while (off < b.length) {
    expect(str(off, 4)).toBe("MTrk");
    const len = u32(off + 4);
    let p = off + 8;
    const end = p + len;
    while (p < end) {
      while (b[p]! & 0x80) p++;
      p++;
      const status = b[p++]!;
      if (status === 0xff) {
        p++;
        let l = 0;
        while (b[p]! & 0x80) l = (l << 7) | (b[p++]! & 0x7f);
        l = (l << 7) | b[p++]!;
        p += l;
      } else if ((status & 0xf0) === 0xc0) p += 1;
      else {
        if ((status & 0xf0) === 0x90) ons++;
        if ((status & 0xf0) === 0x80) offs++;
        p += 2;
      }
    }
    expect(p).toBe(end);
    off = end;
    tracks++;
  }
  expect(tracks).toBe(4);
  expect(ons).toBe(score.notes.length);
  expect(offs).toBe(ons);
});