import type { CommitStat } from "./types";

export const ROOT_DIR = "(root)";

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
}

export interface BucketOptions {
  slices?: number;

  gapScaleSeconds?: number;
}

export function topDir(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? ROOT_DIR : path.slice(0, i);
}

export function bucketCommits(commits: CommitStat[], opts: BucketOptions = {}): Slice[] {
  const n = opts.slices ?? 256;
  const scale = opts.gapScaleSeconds ?? 3600;
  if (commits.length === 0) return [];

  const sorted = commits
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.time - b.c.time || a.i - b.i)
    .map((x) => x.c);

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
    firstTime: null,
    lastTime: null,
  }));
  const authorSets: Set<string>[] = Array.from({ length: n }, () => new Set());

  sorted.forEach((c, i) => {
    const p = total > 0 ? pos[i]! / total : sorted.length > 1 ? i / (sorted.length - 1) : 0;
    const s = slices[Math.min(n - 1, Math.floor(p * n))]!;

    s.commitCount++;
    s.filesChanged += c.filesChanged;
    s.added += c.added;
    s.removed += c.removed;
    authorSets[s.index]!.add(c.author);
    for (const path of c.paths) {
      const d = topDir(path);
      s.dirs[d] = (s.dirs[d] ?? 0) + 1;
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