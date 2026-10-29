import type { CommitStat } from "./types";

export const ROOT_DIR = "(root)";

// Sample caps: slices keep only a few hashes/paths as examples rather than full membership lists.
const HASHES_PER_SLICE = 4;
const PATHS_PER_SLICE = 8;

/**
 * One fixed-width segment of the commit timeline. Slices are ordered in time (`index` 0 is oldest)
 * and cover the same amount of *gap-warped* time, so each one holds a varying number of commits.
 * `dirs` counts touched files per top-level directory; `cumulativeNet` is a running line total.
 */
export interface Slice {
  index: number;
  commitCount: number;
  filesChanged: number;
  added: number;
  removed: number;
  cumulativeNet: number;
  authors: string[];
  dirs: Record<string, number>;
  firstTime: number | null;
  lastTime: number | null;
  hashes: string[];
  paths: string[];
}

export interface BucketOptions {
  /** Number of output slices; the timeline is divided evenly across them. */
  slices?: number;

  /** Gap in seconds that counts as one unit of musical time when warping the timeline. */
  gapScaleSeconds?: number;
}

export function topDir(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? ROOT_DIR : path.slice(0, i);
}

/**
 * Distributes commits across a fixed number of slices over a warped timeline: each inter-commit
 * gap contributes `log1p(gap / scale)` instead of its raw length, so busy periods spread out and
 * multi-month dormancies collapse into a single step.
 */
export function bucketCommits(commits: CommitStat[], opts: BucketOptions = {}): Slice[] {
  const n = opts.slices ?? 256;
  const scale = opts.gapScaleSeconds ?? 3600;
  if (commits.length === 0) return [];

  // Stable by design: equal timestamps fall back to input position so output stays deterministic.
  const sorted = commits
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.time - b.c.time || a.i - b.i)
    .map((x) => x.c);

  // Warped position per commit; negative gaps are clamped since `git log --reverse` can still emit
  // non-monotonic author dates after rebases.
  const pos: number[] = [0];
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.max(0, sorted[i]!.time - sorted[i - 1]!.time);
    pos.push(pos[i - 1]! + Math.log1p(gap / scale));
  }
  const total = pos[pos.length - 1]!;

  const slices: Slice[] = Array.from({ length: n }, (_, index) => ({
    index,
    commitCount: 0,
    filesChanged: 0,
    added: 0,
    removed: 0,
    cumulativeNet: 0,
    authors: [],
    dirs: {},
    hashes: [],
    paths: [],
    firstTime: null,
    lastTime: null,
  }));
  const authorSets: Set<string>[] = Array.from({ length: n }, () => new Set());

  sorted.forEach((c, i) => {
    // Normalise to 0..1; when every commit shares one timestamp the timeline has no extent, so fall
    // back to index order to keep the commits spread across slices.
    const p = total > 0 ? pos[i]! / total : sorted.length > 1 ? i / (sorted.length - 1) : 0;
    // A commit at p === 1 would index past the end, so pin it into the final slice.
    const s = slices[Math.min(n - 1, Math.floor(p * n))]!;

    s.commitCount++;
    s.filesChanged += c.filesChanged;
    s.added += c.added;
    s.removed += c.removed;
    authorSets[s.index]!.add(c.author);
    if (s.hashes.length < HASHES_PER_SLICE) s.hashes.push(c.hash);
    for (const path of c.paths) {
      const d = topDir(path);
      s.dirs[d] = (s.dirs[d] ?? 0) + 1;
      if (s.paths.length < PATHS_PER_SLICE) s.paths.push(path);
    }
    s.firstTime ??= c.time;
    s.lastTime = c.time;
  });

  let net = 0;
  for (const s of slices) {
    net += s.added - s.removed;
    s.cumulativeNet = net;
    s.authors = [...authorSets[s.index]!].sort();
  }

  return slices;
}