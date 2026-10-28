export interface RepoRef {
  owner: string;
  repo: string;
  slug: string;
  url: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

const validSegment = (s: string) => SEGMENT.test(s) && s !== "." && s !== "..";

export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim();
  if (!s || s.length > 200) return null;

  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^(www\.)?github\.com\//i, "");
  const [owner, rawRepo] = s.split("/");
  if (!owner || !rawRepo) return null;

  const repo = rawRepo.replace(/\.git$/i, "").split(/[?#]/)[0]!;
  if (!validSegment(owner) || !validSegment(repo)) return null;

  return { owner, repo, slug: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}.git` };
}