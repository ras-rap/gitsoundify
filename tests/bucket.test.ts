import { expect, test } from "bun:test";
import { bucketCommits, ROOT_DIR, topDir } from "../src/extract/bucket";
import type { CommitStat } from "../src/extract/types";

/** One commit of a fixed shape; `time` is epoch seconds and churn defaults to +10/-2. */
const commit = (time: number, over: Partial<CommitStat> = {}): CommitStat => ({
  hash: `h${time}`,
  time,
  author: "ada",
  message: "m",
  filesChanged: 1,
  added: 10,
  removed: 2,
  paths: ["src/a.ts"],
  ...over,
});

const MIN = 60;
const DAY = 86400;

test("empty history gives no slices", () => {
  expect(bucketCommits([])).toEqual([]);
});

test("always returns exactly N slices, first commit in 0, last in N-1", () => {
  const s = bucketCommits([commit(0), commit(DAY), commit(5 * DAY)], { slices: 32 });
  // The first commit pins to slice 0 and the last to slice N-1, filling every slice in between.
  expect(s).toHaveLength(32);
  expect(s[0]!.commitCount).toBe(1);
  expect(s[31]!.commitCount).toBe(1);
});

test("totals are preserved", () => {
  const input = Array.from({ length: 50 }, (_, i) => commit(i * 7 * DAY, { added: i, removed: 1 }));
  const s = bucketCommits(input, { slices: 20 });
  expect(s.reduce((n, x) => n + x.commitCount, 0)).toBe(50);
  expect(s.reduce((n, x) => n + x.added, 0)).toBe(input.reduce((n, c) => n + c.added, 0));
  expect(s.at(-1)!.cumulativeNet).toBe(input.reduce((n, c) => n + c.added - c.removed, 0));
});

test("input order doesn't matter", () => {
  const a = [commit(0), commit(DAY), commit(3 * DAY)];
  expect(bucketCommits([...a].reverse(), { slices: 16 })).toEqual(bucketCommits(a, { slices: 16 }));
});

test("a long dormant gap shows up as empty slices without swallowing the bursts", () => {
  const burstA = [0, 5 * MIN, 10 * MIN].map((t) => commit(t));
  const burstB = [0, 5 * MIN, 10 * MIN].map((t) => commit(365 * DAY + t));
  const s = bucketCommits([...burstA, ...burstB], { slices: 100 });
  const filled = s.filter((x) => x.commitCount > 0);
  expect(filled.length).toBeLessThanOrEqual(4);
  expect(s.filter((x) => x.commitCount === 0).length).toBeGreaterThan(90);
});

test("log compression: a year of silence isn't 365x a day of silence", () => {
  const day = bucketCommits([commit(0), commit(DAY), commit(2 * DAY)], { slices: 100 });
  const year = bucketCommits([commit(0), commit(DAY), commit(365 * DAY)], { slices: 100 });
  const firstGapSlices = (s: typeof day) => s.findIndex((x, i) => i > 0 && x.commitCount > 0);
  // Slice positions follow log-scaled time, so a year-long gap claims fewer slices than a
  // linear grid would give it; a 365x longer silence must not become 365x more slices.
  expect(firstGapSlices(year)).toBeGreaterThan(0);
  expect(firstGapSlices(year)).toBeLessThan(firstGapSlices(day));
});

test("identical timestamps spread by index instead of collapsing", () => {
  const s = bucketCommits([commit(5), commit(5), commit(5), commit(5)], { slices: 8 });
  // Ties in time break by input index, so identical stamps spread instead of collapsing.
  expect(s.filter((x) => x.commitCount > 0).length).toBeGreaterThan(1);
});

test("single commit lands in slice 0", () => {
  const s = bucketCommits([commit(123)], { slices: 8 });
  expect(s[0]!.commitCount).toBe(1);
});

test("dirs, authors and cumulativeNet carry through", () => {
  const s = bucketCommits(
    [
      commit(0, { author: "bo", paths: ["README.md", "src/a.ts", "src/b.ts"], added: 5, removed: 0 }),
      commit(DAY, { author: "ada", paths: ["docs/x.md"], added: 0, removed: 3 }),
    ],
    { slices: 4 },
  );
  // Files with no directory land in the ROOT_DIR bucket.
  expect(s[0]!.dirs).toEqual({ [ROOT_DIR]: 1, src: 2 });
  expect(s[0]!.authors).toEqual(["bo"]);
  // cumulativeNet keeps accruing across slices, so the last slice carries the repo-wide net (+5, -3).
  expect(s[1]!.cumulativeNet).toBe(5);
  expect(s[3]!.cumulativeNet).toBe(2);
});

test("topDir", () => {
  expect(topDir("a.ts")).toBe(ROOT_DIR);
  expect(topDir("src/deep/a.ts")).toBe("src");
});