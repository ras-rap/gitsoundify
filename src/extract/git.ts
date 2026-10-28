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

export async function gitMaybe(dir: string, args: string[]): Promise<string | null> {
  try {
    return await git(dir, args);
  } catch {
    return null;
  }
}