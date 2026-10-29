import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { git } from "./git";
import { readHistory, type HistoryOptions } from "./history";
import { buildTree, extensionBytes, findReadme, readTree } from "./tree";
import type { RepoSnapshot } from "./types";

export type { RepoSnapshot, CommitStat, TreeNode } from "./types";

// Hard ceiling on cloning: a stalled network or credential prompt must fail, not hang the request.
const CLONE_TIMEOUT_MS = 90_000;

export interface ExtractOptions extends HistoryOptions {}

/**
 * Classifies a CLI argument: a git URL stays as-is, a non-existent `owner/repo` shorthand expands to
 * a GitHub URL, and anything else is treated as a local path.
 */
export function resolveSource(input: string): { kind: "local"; path: string } | { kind: "remote"; url: string } {
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(input)) return { kind: "remote", url: input };
  if (!existsSync(input) && /^[\w.-]+\/[\w.-]+$/.test(input)) {
    return { kind: "remote", url: `https://github.com/${input}.git` };
  }
  return { kind: "local", path: resolve(input) };
}

/**
 * Bare-clones `url` into a fresh temp directory and returns its path; the caller owns cleanup.
 * `GIT_TERMINAL_PROMPT=0` makes an unauthenticated private repo fail instead of prompting.
 */
export async function cloneBare(url: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "repo2song-"));
  const proc = Bun.spawn(["git", "clone", "--bare", "--quiet", url, dir], {
    stdout: "ignore",
    stderr: "pipe",
    timeout: CLONE_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`clone failed: ${err.trim()}`);
  return dir;
}

/** Last path segment, without a trailing slash or `.git` suffix, used as the snapshot's display name. */
function repoName(input: string): string {
  const cleaned = input.replace(/\/+$/, "").replace(/\.git$/, "");
  return basename(cleaned) || "repo";
}

/**
 * Snapshots an already-cloned git dir. A repo with no refs (fresh `init`, empty clone) short-circuits
 * to an empty snapshot with a null head rather than letting `rev-parse HEAD` throw.
 */
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
    // readHistory yields commits oldest-first, so the ends of the list are the repo's time span.
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