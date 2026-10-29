import { expect, test } from "bun:test";
import { compose, composeAmbient, composeBlend, composeStructure } from "../src/compose";
import type { Score } from "../src/compose/score";
import { buildTree } from "../src/extract/tree";
import type { CommitStat, RepoSnapshot } from "../src/extract/types";

const DAY = 86400;

/** One commit per day starting at epoch 0 with fixed +20/-5 churn; `over` replaces individual fields. */
function commit(i: number, over: Partial<CommitStat> = {}): CommitStat {
  return {
    hash: `h${i}`,
    time: i * DAY,
    author: "ada",
    message: "work",
    filesChanged: 1,
    added: 20,
    removed: 5,
    paths: [`src/f${i}.ts`],
    ...over,
  };
}

/** The tree is held constant here: ambient mode is scored from commit history, so only that varies. */
function snapOf(commits: CommitStat[], name = "demo"): RepoSnapshot {
  return {
    name,
    head: "abc",
    commitCount: commits.length,
    firstCommitAt: commits[0]?.time ?? null,
    lastCommitAt: commits.at(-1)?.time ?? null,
    commits,
    tree: buildTree([{ path: "src/a.ts", size: 400 }], name),
    readme: null,
    extensions: {},
  };
}

/** Sections tile the piece and every note stays in legal MIDI/velocity ranges; pan, when set, is -1..1. */
function checkInvariants(s: Score) {
  let pos = 0;
  for (const sec of s.sections) {
    expect(sec.start).toBe(pos);
    pos += sec.length;
  }
  expect(pos).toBeCloseTo(s.lengthBeats, 6);
  for (const n of s.notes) {
    expect(n.midi).toBeGreaterThanOrEqual(0);
    expect(n.midi).toBeLessThanOrEqual(127);
    expect(n.velocity).toBeGreaterThan(0);
    expect(n.velocity).toBeLessThanOrEqual(1);
    expect(n.duration).toBeGreaterThan(0);
    expect(n.time).toBeGreaterThanOrEqual(0);
    expect(n.time + n.duration).toBeLessThanOrEqual(s.lengthBeats + 1e-9);
    if (n.pan !== undefined) {
      expect(n.pan).toBeGreaterThanOrEqual(-1);
      expect(n.pan).toBeLessThanOrEqual(1);
    }
  }
}

test("deterministic: same snapshot gives an identical score", () => {
  const snap = () => snapOf(Array.from({ length: 120 }, (_, i) => commit(i)));
  expect(composeAmbient(snap())).toEqual(composeAmbient(snap()));
});

test("empty repo yields one sustained tone, not an error", () => {
  const s = composeAmbient(snapOf([]));
  expect(s.notes.filter((n) => n.track === "drone")).toHaveLength(1);
  expect(s.lengthBeats).toBeGreaterThan(0);
  checkInvariants(s);
});

test("single commit still produces a valid piece", () => {
  checkInvariants(composeAmbient(snapOf([commit(0)])));
});

test("invariants hold across repo shapes", () => {
  checkInvariants(composeAmbient(snapOf(Array.from({ length: 3 }, (_, i) => commit(i)))));
  checkInvariants(composeAmbient(snapOf(Array.from({ length: 900 }, (_, i) => commit(i, { added: 1, removed: 900 })))));
});

test("a long dormant gap becomes silence in the middle of the piece", () => {
  const burstA = [0, 60, 120].map((t) => commit(t));
  const burstB = [0, 60, 120].map((t) => commit(t, { time: 365 * DAY + t }));
  const s = composeAmbient(snapOf([...burstA, ...burstB]));

  const lo = s.lengthBeats * 0.35;
  const hi = s.lengthBeats * 0.65;
  const startsInGap = s.notes.filter((n) => n.track !== "drone" && n.time > lo && n.time < hi);
  // A year of dead time maps to the middle third, where only the drone may sound.
  expect(startsInGap).toHaveLength(0);
});

test("deletions thin the texture", () => {
  const commits = Array.from({ length: 60 }, (_, i) =>
    i < 30 ? commit(i, { added: 200, removed: 0 }) : commit(i, { added: 0, removed: 200 }),
  );
  const s = composeAmbient(snapOf(commits));
  const mid = s.lengthBeats / 2;
  const early = s.notes.filter((n) => n.track === "pad" && n.time < mid).length;
  const late = s.notes.filter((n) => n.track === "pad" && n.time >= mid).length;
  // The second half is deletions only, so the pad must thin out rather than hold its density.
  expect(late).toBeLessThan(early);
});

test("stereo: a solo repo stays centred, multiple authors spread out", () => {
  const solo = composeAmbient(snapOf(Array.from({ length: 60 }, (_, i) => commit(i))));
  // One author means one pan position for the whole piece.
  expect(new Set(solo.notes.map((n) => (n.pan ?? 0).toFixed(3))).size).toBe(1);

  const duo = composeAmbient(
    snapOf(Array.from({ length: 60 }, (_, i) => commit(i, { author: i % 2 === 0 ? "ada" : "bo" }))),
  );
  expect(new Set(duo.notes.map((n) => (n.pan ?? 0).toFixed(3))).size).toBeGreaterThan(1);
});

test("historyWeight 0 blends back to pure structure", () => {
  const snap = snapOf(Array.from({ length: 20 }, (_, i) => commit(i)));
  const structure = composeStructure(snap);
  const blend = composeBlend(snap);

  // At historyWeight 0 the blend must inherit structure's key, tempo, length and section grid
  // verbatim and only layer ambient texture on top.
  expect(blend.mode).toBe("blend");
  expect(blend.bpm).toBe(structure.bpm);
  expect(blend.key).toEqual(structure.key);
  expect(blend.lengthBeats).toBe(structure.lengthBeats);
  expect(blend.sections).toEqual(structure.sections);
  expect(blend.notes.some((n) => n.track === "drone")).toBe(true);
  checkInvariants(blend);
});

test("compose() routes every mode", () => {
  const snap = snapOf(Array.from({ length: 60 }, (_, i) => commit(i)));
  expect(compose(snap, "structure").mode).toBe("structure");
  expect(compose(snap, "ambient").mode).toBe("ambient");
  expect(compose(snap, "blend").mode).toBe("blend");
});