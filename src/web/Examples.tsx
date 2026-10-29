import type { Example } from "./examples";

export function Examples({
  examples,
  busy,
  onPick,
}: {
  examples: Example[];
  busy: boolean;
  onPick: (repo: string) => void;
}) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      {examples.map((ex) => (
        <button
          key={ex.repo}
          type="button"
          disabled={busy}
          onClick={() => onPick(ex.repo)}
          className="group flex flex-col rounded-xl bg-white/[0.04] p-4 text-left ring-1 ring-white/10 transition hover:bg-white/[0.07] hover:ring-indigo-400/40 disabled:opacity-40"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-white">{ex.title}</span>
            <span className="text-[11px] text-gray-500 transition group-hover:text-indigo-300">listen →</span>
          </div>
          <p className="mt-2 flex-1 text-xs leading-relaxed text-gray-400">{ex.blurb}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {ex.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] tracking-wide text-gray-500 uppercase"
              >
                {t}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}