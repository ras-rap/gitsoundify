import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { git } from "./git";
import { readHistory, type HistoryOptions } from "./history";
import { buildTree, extensionBytes, findReadme, readTree } from "./tree";
import type { RepoSnapshot } from "./types";

export type { RepoSnapshot, CommitStat, TreeNode } from "./types";

export interface ExtractOptions extends HistoryOptions {}

export function resolveSource(input: string): { kind: "local"; path: string } | { kind: "remote"; url: string } {
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(input)) return { kind: "remote", url: input };
  if (!existsSync(input) && /^[\w.-]+\/[\w.-]+$/.test(input)) {
    return { kind: "remote", url: `https://github.com/${input}.git` };
  }
  return { kind: "local", path: resolve(input) };
}

export async function cloneBare(url: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "repo2song-"));
  const proc = Bun.spawn(["git", "clone", "--bare", "--quiet", url, dir], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`clone failed: ${err.trim()}`);
  return dir;
}

function repoName(input: string): string {
  const cleaned = input.replace(/\/+$/, "").replace(/\.git$/, "");
  return basename(cleaned) || "repo";
}

export async function extractRepo(
  dir: string,
  name: string,
  opts: ExtractOptions = {},
): Promise<RepoSnapshot> {
  const hasRefs = (await git(dir, ["for-each-ref", "--count=1"])).trim().length > 0;

  if (!hasRefs) {
    return {
      name,
      head: null,
      commitCount: 0,
      firstCommitAt: null,
      lastCommitAt: null,
      commits: [],
      tree: buildTree([], name),
      readme: null,
      extensions: {},
    };
  }

  const head = (await git(dir, ["rev-parse", "--verify", "HEAD"])).trim();

  const [{ commits, total }, entries] = await Promise.all([readHistory(dir, opts), readTree(dir)]);

  return {
    name,
    head,
    commitCount: total,
    firstCommitAt: commits[0]?.time ?? null,
    lastCommitAt: commits.at(-1)?.time ?? null,
    commits,
    tree: buildTree(entries, name),
    readme: await findReadme(dir, entries),
    extensions: extensionBytes(entries),
  };
}

export async function extractFromSource(input: string, opts: ExtractOptions = {}): Promise<RepoSnapshot> {
  const source = resolveSource(input);

  if (source.kind === "local") {
    return extractRepo(source.path, repoName(source.path), opts);
  }

  const dir = await cloneBare(source.url);
  try {
    return await extractRepo(dir, repoName(source.url), opts);
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet();
  }
}