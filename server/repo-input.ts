export interface RepoRef {
  owner: string;
  repo: string;
  slug: string;
  url: string;
}

// GitHub allows only these in owner/repo names, which also keeps the value safe inside a git URL.
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

// "." and ".." pass the character class but would let a path escape the clone target.
const validSegment = (s: string) => SEGMENT.test(s) && s !== "." && s !== "..";

/**
 * Accepts `owner/repo`, `github.com/owner/repo`, or a full https URL (any trailing `/tree/...`,
 * `?query`, `#fragment` or `.git` is dropped). Returns null on anything else so callers can
 * answer 400 without touching git.
 */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim();
  if (!s || s.length > 200) return null;

  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^(www\.)?github\.com\//i, "");
  const [owner, rawRepo] = s.split("/"); // Only the first two segments matter; deeper paths are ignored.
  if (!owner || !rawRepo) return null;

  const repo = rawRepo.replace(/\.git$/i, "").split(/[?#]/)[0]!;
  if (!validSegment(owner) || !validSegment(repo)) return null;

  return { owner, repo, slug: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}.git` };
}