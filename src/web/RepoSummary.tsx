import type { RepoSnapshot } from "../extract/types";

const fmtMonth = (unix: number | null) =>
  unix ? new Date(unix * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short" }) : "—";

const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Top extensions by byte share. `extensionBytes` keys extensionless files as "". */
function languages(extensions: Record<string, number>, limit = 3) {
  const total = Object.values(extensions).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(extensions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ext, bytes]) => ({ ext: ext || "other", pct: Math.round((bytes / total) * 100) }));
}

export function RepoSummary({ snapshot }: { snapshot: RepoSnapshot }) {
  const langs = languages(snapshot.extensions);

  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
      {snapshot.readme?.firstLine && (
        <p className="mb-3 line-clamp-2 text-sm text-gray-300">{snapshot.readme.firstLine}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
        <Stat label="commits" value={fmtCount(snapshot.commitCount)} />
        <Stat label="span" value={`${fmtMonth(snapshot.firstCommitAt)} – ${fmtMonth(snapshot.lastCommitAt)}`} />
        <Stat label="head" value={snapshot.head?.slice(0, 7) ?? "empty"} mono />
        <Stat label="files" value={fmtCount(snapshot.tree.fileCount)} />
      </dl>

      {langs.length > 0 && (
        <div className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-full bg-white/5">
          {langs.map((l, i) => (
            <div
              key={l.ext}
              title={`${l.ext} · ${l.pct}% of bytes`}
              style={{ width: `${l.pct}%`, opacity: 1 - i * 0.25 }}
              className="bg-indigo-400"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-gray-500 uppercase">{label}</dt>
      <dd className={`mt-0.5 text-gray-200 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}