import { join, normalize, sep } from "node:path";
import { extractFromSource } from "../src/extract";
import type { RepoSnapshot } from "../src/extract/types";
import { parseRepoInput } from "./repo-input";
import { badgeFor, badgeSvg } from "./badge";


const PORT = Number(process.env.PORT ?? 3001);
const DIST = join(import.meta.dir, "..", "dist");

/**
 * Snapshots are cached for 10 minutes, a 4th concurrent clone is refused with 429, and `maxCommits`
 * defaults to 2000 with a hard clamp at 20000.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_CLONES = 3;
const DEFAULT_MAX_COMMITS = 2000;
const HARD_MAX_COMMITS = 20000;
const BADGE_MAX_COMMITS = 200;


const cache = new Map<string, { at: number; snap: RepoSnapshot }>();
const inflight = new Map<string, Promise<RepoSnapshot>>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Snapshot lookup keyed by url+maxCommits, so callers asking for the same depth share one clone. */
async function getSnapshot(url: string, maxCommits: number): Promise<RepoSnapshot> {
  const key = `${url}|${maxCommits}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.snap;

  const pending = inflight.get(key);
  if (pending) return pending; // Single-flight: join the clone already running for this key.

  const p = extractFromSource(url, { maxCommits })
    .then((snap) => {
      cache.set(key, { at: Date.now(), snap });
      return snap;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function handleBadge(url: URL): Promise<Response> {
  // /badge/owner/repo.svg
  const m = /^\/badge\/([^/]+)\/([^/]+?)(?:\.svg)?$/.exec(url.pathname);
  const svg = (body: string, cache: string) =>
    new Response(body, {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": cache },
    });

  if (!m) return svg(badgeSvg("gitsoundify", "bad repo", "#ef4444"), "public, max-age=60");

  const ref = parseRepoInput(`${m[1]}/${m[2]}`);
  if (!ref) return svg(badgeSvg("gitsoundify", "invalid repo", "#ef4444"), "public, max-age=60");

  const pinned = url.searchParams.get("mode") ?? undefined;

  try {
    const snap = await getSnapshot(ref.url, BADGE_MAX_COMMITS);
    // Long-lived: the score is deterministic, so the badge only changes when the repo changes.
    return svg(badgeFor(snap, pinned), "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
  } catch {
    // Short-lived on failure, so a transient clone error isn't cached for a day.
    return svg(badgeSvg("gitsoundify", "not found", "#ef4444"), "public, max-age=300");
  }
}

/** GET /api/snapshot?repo=&max= — JSON errors carry the HTTP status the client shows. */
async function handleSnapshot(url: URL): Promise<Response> {
  const ref = parseRepoInput(url.searchParams.get("repo") ?? "");
  if (!ref) return json({ error: "Enter a GitHub repo like owner/repo or a github.com URL." }, 400);

  const requested = Number(url.searchParams.get("max"));
  const maxCommits = Number.isFinite(requested) && requested > 0 ? Math.min(requested, HARD_MAX_COMMITS) : DEFAULT_MAX_COMMITS;

  // Joining a clone that is already running is not new work, so it bypasses the concurrency gate.
  if (inflight.size >= MAX_CONCURRENT_CLONES && !inflight.has(`${ref.url}|${maxCommits}`)) {
    return json({ error: "The server is busy cloning other repos. Try again in a moment." }, 429);
  }

  try {
    return json(await getSnapshot(ref.url, maxCommits));
  } catch (err) {
    
    console.error(`[snapshot] ${ref.slug}:`, err instanceof Error ? err.message : err);
    return json({ error: `Couldn't read ${ref.slug}. Check the name and that the repo is public.` }, 502);
  }
}

/** Serves dist/, rejecting anything that resolves outside it and falling back to index.html for SPA routes. */
async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const full = normalize(join(DIST, rel));
  // Traversal guard: prefix-check the normalised path, not the raw one.
  if (full !== DIST && !full.startsWith(DIST + sep)) return new Response("Forbidden", { status: 403 });

  const file = Bun.file(full);
  if (await file.exists()) return new Response(file);

  const index = Bun.file(join(DIST, "index.html")); 
  if (await index.exists()) return new Response(index);
  return new Response("No build found. Run `bun run build`, or use `bun run dev` for development.", { status: 404 });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/snapshot") return handleSnapshot(url);
    if (url.pathname.startsWith("/badge/")) return handleBadge(url);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return serveStatic(url.pathname);
  },
});

console.log(`repo-to-song server on http://localhost:${PORT}`);