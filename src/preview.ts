import { existsSync } from "node:fs";
import { bucketCommits } from "./extract/bucket";
import { extractFromSource } from "./extract";
import type { RepoSnapshot } from "./extract/types";

const args = Bun.argv.slice(2);
const maxIdx = args.indexOf("--max");
const maxCommits = maxIdx !== -1 ? Number(args.splice(maxIdx, 2)[1]) : undefined;
const [input, slicesArg] = args;
if (!input) {
  console.error("usage: bun run preview <snapshot.json | path | git-url | owner/repo> [slices] [--max N]");
  process.exit(1);
}

// A local .json snapshot is replayed instead of cloning, which makes previewing deterministic.
const snap: RepoSnapshot =
  input.endsWith(".json") && existsSync(input)
    ? await Bun.file(input).json()
    : await extractFromSource(input, { maxCommits });
const n = Number(slicesArg) || 64; // Default slice count when [slices] is omitted or not a number.
const slices = bucketCommits(snap.commits, { slices: n });

// Eighth-height blocks, shortest to tallest.
const BARS = "▁▂▃▄▅▆▇█";
/** Scale values to the series max; zero (or negative) renders as emptyChar so gaps stay visible. */
const spark = (vals: number[], emptyChar = "·") => {
  const max = Math.max(...vals, 1);
  // ceil() keeps any non-zero value off the empty char; min() guards the v === max bucket.
  return vals.map((v) => (v <= 0 ? emptyChar : BARS[Math.min(BARS.length - 1, Math.ceil((v / max) * BARS.length) - 1)]!)).join("");
};

console.log(`${snap.name}: ${snap.commits.length} commits -> ${slices.length} slices\n`);
console.log("commits   ", spark(slices.map((s) => s.commitCount)));
console.log("churn     ", spark(slices.map((s) => s.added + s.removed)));
console.log("size (net)", spark(slices.map((s) => Math.max(0, s.cumulativeNet)), "▁"));
console.log("authors   ", spark(slices.map((s) => s.authors.length)));
console.log(`\nempty slices: ${slices.filter((s) => s.commitCount === 0).length}/${slices.length}`);