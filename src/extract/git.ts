/**
 * Runs `git` in `dir` and resolves with stdout, throwing with trimmed stderr on a non-zero exit.
 * `core.quotepath=off` keeps non-ASCII paths raw instead of octal-escaped, so they match the paths
 * produced by `--numstat` and `ls-tree -z` parsers.
 */
export async function git(dir: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-c", "core.quotepath=off", "-C", dir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${err.trim()}`);
  }
  return out;
}

/** Like {@link git} but resolves null instead of throwing, for probes where absence is expected. */
export async function gitMaybe(dir: string, args: string[]): Promise<string | null> {
  try {
    return await git(dir, args);
  } catch {
    return null;
  }
}