import { git } from "./git";
import type { CommitStat } from "./types";

// ASCII record/field separators: they cannot appear in a git path and are vanishingly rare in
// commit messages, so splitting on them is safer than newlines or tabs.
const RS = "\x1e";
const US = "\x1f";

// Per-commit path sample; the numstat walk still counts every file.
const PATHS_PER_COMMIT_CAP = 64;

// Tab-free header so the `--numstat` body that follows splits cleanly: hash, author time in Unix
// seconds, author name, subject.
const LOG_FORMAT = "%x1e%H%x1f%at%x1f%aN%x1f%s";

/** Parses the {@link LOG_FORMAT} + `--numstat` output produced by {@link readHistory}. */
export function parseLog(raw: string): CommitStat[] {
  const commits: CommitStat[] = [];

  for (const record of raw.split(RS)) {
    if (!record.trim()) continue;

    const nl = record.indexOf("\n");
    const header = nl === -1 ? record : record.slice(0, nl);
    const body = nl === -1 ? "" : record.slice(nl + 1);

    const [hash, at, author = "", message = ""] = header.split(US);
    if (!hash || !at) continue;

    let filesChanged = 0;
    let added = 0;
    let removed = 0;
    const paths: string[] = [];

    for (const line of body.split("\n")) {
      if (!line) continue;
      const [a, r, ...rest] = line.split("\t");
      // Paths may themselves contain tabs, so re-join everything after the two counts.
      const path = rest.join("\t");
      if (!path) continue;

      filesChanged++;
      // Binary files report "-" instead of a count; skip them rather than adding NaN.
      if (a !== "-") added += Number(a) || 0;
      if (r !== "-") removed += Number(r) || 0;
      if (paths.length < PATHS_PER_COMMIT_CAP) paths.push(path);
    }

    commits.push({
      hash,
      time: Number(at),
      author,
      message,
      filesChanged,
      added,
      removed,
      paths,
    });
  }

  return commits;
}

export interface HistoryOptions {
  maxCommits?: number;
}

/**
 * Reads non-merge commits, oldest first. `total` counts every non-merge commit even when
 * `maxCommits` truncates the returned list (the newest N are kept, then reversed).
 */
export async function readHistory(
  dir: string,
  opts: HistoryOptions = {},
): Promise<{ commits: CommitStat[]; total: number }> {
  const total = Number(
    (await git(dir, ["rev-list", "--count", "--no-merges", "HEAD"])).trim(),
  );

  const args = [
    "log",
    "--no-merges",
    // Plain paths instead of "old => new" rename notation, which would corrupt top-dir bucketing.
    "--no-renames",
    "--numstat",
    "--reverse",
    `--format=${LOG_FORMAT}`,
  ];
  if (opts.maxCommits) args.push(`--max-count=${opts.maxCommits}`);

  const raw = await git(dir, args);
  return { commits: parseLog(raw), total };
}