
import { extractFromSource } from "./extract";
 
const args = Bun.argv.slice(2);
const maxIdx = args.indexOf("--max");
// Splice --max and its value out so the source stays at args[0].
const maxCommits = maxIdx !== -1 ? Number(args.splice(maxIdx, 2)[1]) : undefined;
const source = args[0];
 
if (!source) {
  console.error("usage: bun run src/cli.ts <path | git-url | owner/repo> [--max N] > snapshot.json");
  process.exit(1);
}
 
const started = performance.now();
const snapshot = await extractFromSource(source, { maxCommits });
 
// Progress goes to stderr so stdout stays a clean, redirectable snapshot.json.
console.error(
  `${snapshot.name}: ${snapshot.commits.length}/${snapshot.commitCount} commits, ` +
    `${snapshot.tree.fileCount} files, ${((performance.now() - started) / 1000).toFixed(2)}s`,
);
console.log(JSON.stringify(snapshot, null, 2));
 