import { compose, selectMode, type Mode } from "./compose";
import { scoreSeconds } from "./compose/score";
import { extractFromSource } from "./extract";
import { scoreToMidi } from "./render/midi";

const args = Bun.argv.slice(2);
const take = (flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const out = take("--out");
const max = take("--max");
const modeArg = take("--mode");
const source = args[0];

if (!source) {
  console.error("usage: bun run song <path | git-url | owner/repo> [--mode structure|ambient|blend] [--out file.mid] [--max N]");
  process.exit(1);
}

const snap = await extractFromSource(source, { maxCommits: max ? Number(max) : undefined });
const mode: Mode =
  modeArg === "structure" || modeArg === "ambient" || modeArg === "blend" ? modeArg : selectMode(snap.commitCount);
const score = compose(snap, mode);
const file = out ?? `${snap.name}.${score.mode}.mid`;
await Bun.write(file, scoreToMidi(score));

const secs = Math.round(scoreSeconds(score));
console.log(`${snap.name}  [${score.mode} mode]`);
console.log(`key: ${score.key.scale}, root pitch class ${score.key.root}  |  ${score.bpm} bpm  |  ${secs}s  |  ${score.notes.length} notes`);
console.log(`sections: ${score.sections.map((s) => `${s.name} (${(s.length / 4).toFixed(1)} bars)`).join(", ")}`);
console.log(`wrote ${file}`);