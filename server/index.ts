import { join, normalize, sep } from "node:path";
import { extractFromSource } from "../src/extract";
import type { RepoSnapshot } from "../src/extract/types";
import { parseRepoInput } from "./repo-input";

const PORT = Number(process.env.PORT ?? 3001);
const DIST = join(import.meta.dir, "..", "dist");

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_CLONES = 3;
const DEFAULT_MAX_COMMITS = 2000;
const HARD_MAX_COMMITS = 20000;

const cache = new Map<string, { at: number; snap: RepoSnapshot }>();
const inflight = new Map<string, Promise<RepoSnapshot>>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function getSnapshot(url: string, maxCommits: number): Promise<RepoSnapshot> {
  const key = `${url}|${maxCommits}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.snap;

  const pending = inflight.get(key);
  if (pending) return pending; 

  const p = extractFromSource(url, { maxCommits })
    .then((snap) => {
      cache.set(key, { at: Date.now(), snap });
      return snap;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function handleSnapshot(url: URL): Promise<Response> {
  const ref = parseRepoInput(url.searchParams.get("repo") ?? "");
  if (!ref) return json({ error: "Enter a GitHub repo like owner/repo or a github.com URL." }, 400);

  const requested = Number(url.searchParams.get("max"));
  const maxCommits = Number.isFinite(requested) && requested > 0 ? Math.min(requested, HARD_MAX_COMMITS) : DEFAULT_MAX_COMMITS;

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

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const full = normalize(join(DIST, rel));
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
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return serveStatic(url.pathname);
  },
});

console.log(`repo-to-song server on http://localhost:${PORT}`);