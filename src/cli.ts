
import { extractFromSource } from "./extract";
 
const args = Bun.argv.slice(2);
const maxIdx = args.indexOf("--max");
const maxCommits = maxIdx !== -1 ? Number(args.splice(maxIdx, 2)[1]) : undefined;
const source = args[0];
 
if (!source) {
  console.error("usage: bun run src/cli.ts <path | git-url | owner/repo> [--max N] > snapshot.json");
  process.exit(1);
}
 
const started = performance.now();
const snapshot = await extractFromSource(source, { maxCommits });
 
console.error(
  `${snapshot.name}: ${snapshot.commits.length}/${snapshot.commitCount} commits, ` +
    `${snapshot.tree.fileCount} files, ${((performance.now() - started) / 1000).toFixed(2)}s`,
);
console.log(JSON.stringify(snapshot, null, 2));
 