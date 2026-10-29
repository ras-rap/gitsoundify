import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compose, selectMode, type Mode } from "../compose";
import { scoreSeconds, type TrackId } from "../compose/score";
import { describeSource } from "../compose/source";
import type { RepoSnapshot } from "../extract/types";
import { scoreToMidi } from "../render/midi";
import { Engine, TAIL_SECONDS } from "./engine";
import { EXAMPLES } from "./examples";
import { Examples } from "./Examples.tsx";
import { formatTime, noteName } from "./format";
import { isModeChoice, MODE_COPY, MODE_ORDER, type ModeChoice } from "./modes";
import { RepoSummary } from "./RepoSummary";
import { Roll } from "./Roll";
import { TRACK_COLOR } from "./theme";

type Status = "idle" | "loading" | "ready" | "error";
type PlayState = "stopped" | "playing" | "paused";

// Cap on the "currently sounding" legend so dense sections do not flood it.
const MAX_SOUNDING = 6;

/** Only whitelisted ?mode= values are trusted; anything else falls back to auto-picking from commit count. */
const parseMode = (params: URLSearchParams): ModeChoice => {
  const m = params.get("mode");
  return isModeChoice(m) ? m : "auto";
};

export default function App() {
  const engine = useMemo(() => new Engine(), []);
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [input, setInput] = useState(() => initial.get("repo") ?? "");
  const [loadedRepo, setLoadedRepo] = useState("");
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [modeChoice, setModeChoice] = useState<ModeChoice>(() => parseMode(initial));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [playState, setPlayState] = useState<PlayState>("stopped");
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [tempo, setTempo] = useState(1);
  const [density, setDensity] = useState(1);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const loadId = useRef(0);

  const mode = useMemo<Mode | null>(
    () => (snapshot ? (modeChoice === "auto" ? selectMode(snapshot.commitCount) : modeChoice) : null),
    [snapshot, modeChoice],
  );

  // `historyWeight` and a tempo multiplier are the only knobs the composers expose, so the sandbox
  // is just a re-run of `compose` with different options. Note changes identity -> the transport
  // rewinds (see the setScore effect below), which is why the sliders commit on release, not on drag.
  const score = useMemo(() => {
    if (!snapshot || !mode) return null;
    const base = compose(snapshot, mode, { historyWeight: density });
    return tempo === 1 ? base : { ...base, bpm: Math.round(base.bpm * tempo) };
  }, [snapshot, mode, tempo, density]);

  const total = score ? scoreSeconds(score) : 0;

  const load = useCallback(async (value: string) => {
    const repo = value.trim();
    if (!repo) return;
    // Monotonic request id: a slow earlier response must not overwrite a newer one.
    const id = ++loadId.current;

    setStatus("loading");
    setError("");
    setSnapshot(null);

    try {
      const res = await fetch(`/api/snapshot?repo=${encodeURIComponent(repo)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      if (id !== loadId.current) return;

      setSnapshot(body as RepoSnapshot);
      setLoadedRepo(repo);
      setStatus("ready");
      // A fresh repo is a fresh piece: drop sandbox tweaks back to their defaults.
      setTempo(1);
      setDensity(1);
    } catch (e) {
      if (id !== loadId.current) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!score) return;
    // A different score invalidates everything the transport has queued, so rewind before handing it over.
    engine.stop();
    setPlayState("stopped");
    setPosition(0);
    engine.setScore(score);
  }, [score, engine]);

  useEffect(() => {
    if (input) void load(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!snapshot || !loadedRepo) return;
    const params = new URLSearchParams({ repo: loadedRepo });
    if (modeChoice !== "auto") params.set("mode", modeChoice);
    history.replaceState(null, "", `?${params.toString()}`);
  }, [snapshot, loadedRepo, modeChoice]);

  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);

  useEffect(() => {
    if (playState !== "playing") return;
    let raf = 0;
    // Sample the transport each frame rather than having the engine push updates; the loop owns the stop condition.
    const tick = () => {
      const p = engine.position;
      setPosition(p);
      // TAIL_SECONDS lets the last release tails finish before the playhead snaps back to zero.
      if (p >= total + TAIL_SECONDS) {
        engine.stop();
        setPlayState("stopped");
        setPosition(0);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playState, engine, total]);

  const seekTo = useCallback(
    (t: number) => {
      engine.seek(t);
      setPosition(t);
    },
    [engine],
  );

  const toggle = useCallback(async () => {
    if (!score) return;
    if (playState === "playing") {
      engine.pause();
      setPlayState("paused");
      return;
    }
    try {
      // `play` awaits Tone.start() plus the reverb impulse on first run, so this is deliberately async.
      await engine.play();
      setPlayState("playing");
    } catch (e) {
      setPlayState("stopped");
      setError(e instanceof Error ? e.message : "Couldn't start audio.");
    }
  }, [score, playState, engine]);

  // Space toggles, arrows seek. Reading the engine's position (not React state) keeps this effect
  // from re-subscribing on every animation frame.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      if (e.code === "Space") {
        e.preventDefault();
        void toggle();
      } else if (score && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const step = e.shiftKey ? 15 : 5;
        seekTo(Math.max(0, Math.min(total, engine.position + (e.key === "ArrowLeft" ? -step : step))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [score, total, engine, seekTo, toggle]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the URL bar still has the canonical link.
    }
  };

  // `scoreToMidi` is pure (no node imports), so it runs in the browser as-is.
  const downloadMidi = () => {
    if (!score) return;
    const bytes = scoreToMidi(score);
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${score.name.replace(/[^a-z0-9._-]+/gi, "-")}-${score.mode}.mid`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clamp for drawing past the end, then convert to beats: notes and the roll are in beats, the transport in seconds.
  const shown = Math.min(position, total);
  const beat = score ? (shown * score.bpm) / 60 : 0;

  const sounding = useMemo(() => {
    if (!score) return [];
    // Collapse to one entry per track + source label, so a source that overlaps itself is listed once.
    const seen = new Set<string>();
    const out: { track: TrackId; label: string }[] = [];
    for (const n of score.notes) {
      if (n.time > beat || n.time + n.duration <= beat) continue;
      const label = describeSource(n.source);
      const id = `${n.track}:${label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ track: n.track, label });
      if (out.length >= MAX_SOUNDING) break;
    }
    return out;
  }, [score, beat]);

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Git Soundify</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">
          Every repository has a shape. Paste a public GitHub repo and it gets compiled into a short piece —
          folders become sections, files become notes, commit churn becomes tension. Deterministic: the same
          repo always plays the same song.
        </p>
      </header>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo"
          spellCheck={false}
          aria-label="GitHub repository"
          className="min-w-0 flex-1 rounded-lg bg-white/5 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none placeholder:text-gray-500 focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={status === "loading" || !input.trim()}
          className="rounded-lg bg-indigo-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-40"
        >
          {status === "loading" ? "Reading…" : "Load"}
        </button>
      </form>

      <Examples
        examples={EXAMPLES}
        busy={status === "loading"}
        onPick={(repo) => {
          setInput(repo);
          void load(repo);
        }}
      />

      {status === "error" && (
        <div className="mt-6 rounded-lg bg-red-500/10 px-4 py-3 ring-1 ring-red-400/20">
          <p className="text-sm text-red-300">{error}</p>
          <p className="mt-1 text-xs text-red-300/60">Public repos only. Large histories take a few seconds to clone.</p>
        </div>
      )}

      {status === "loading" && (
        <div className="mt-8 rounded-xl bg-white/[0.03] p-6 text-center ring-1 ring-white/10">
          <p className="text-sm text-gray-300">Cloning and reading the repository…</p>
          <p className="mt-1 text-xs text-gray-500">
            Cloning history, walking the tree, then seeding the key from the repo name.
          </p>
        </div>
      )}

      {score && snapshot && status !== "loading" && (
        <section className="mt-8 space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-medium text-white">{score.name}</h2>
            <p className="text-sm text-gray-400">
              {noteName(score.key.root)} {score.key.scale} · {score.bpm} bpm · {score.notes.length} notes ·{" "}
              {MODE_COPY[score.mode].label.toLowerCase()}
            </p>
          </div>

          <RepoSummary snapshot={snapshot} />

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {MODE_ORDER.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModeChoice(m)}
                  aria-pressed={modeChoice === m}
                  className={`rounded-full px-3 py-1 ring-1 transition ${
                    modeChoice === m
                      ? "bg-indigo-500/20 text-indigo-200 ring-indigo-400/40"
                      : "bg-white/5 text-gray-400 ring-white/10 hover:bg-white/10"
                  }`}
                >
                  {MODE_COPY[m].label}
                </button>
              ))}
              {modeChoice === "auto" && mode && (
                <span className="ml-2 text-gray-500">
                  {snapshot.commitCount} commits · picked {MODE_COPY[mode].label.toLowerCase()}
                </span>
              )}
            </div>
            <p className="max-w-2xl text-xs leading-relaxed text-gray-400">{MODE_COPY[modeChoice].blurb}</p>
          </div>

          <Roll score={score} position={shown} onSeek={seekTo} />

          <div className="min-h-[1.75rem]">
            {sounding.length > 0 ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                {sounding.map((s) => (
                  <li key={`${s.track}:${s.label}`} className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-3 rounded-sm" style={{ background: TRACK_COLOR[s.track] }} />
                    <span className="text-gray-500">{s.track}</span>
                    <span className="text-gray-300">{s.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-600">Hover a note to see which file or commit it came from.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void toggle()}
              aria-label={playState === "playing" ? "Pause" : "Play"}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
            >
              {playState === "playing" ? (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <rect x="3" y="2" width="4" height="14" rx="1" />
                  <rect x="11" y="2" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M4 2.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 4 2.5Z" />
                </svg>
              )}
            </button>

            <span className="font-mono text-sm text-gray-300 tabular-nums">
              {formatTime(shown)} / {formatTime(total)}
            </span>

            <label className="flex items-center gap-2 text-xs text-gray-500">
              <span className="sr-only">Volume</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <path d="M2 5v4h2.5L8 12V2L4.5 5H2Z" />
                <path d="M10 4.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-20 accent-indigo-400"
              />
            </label>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copyLink()}
                className="rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                {copied ? "Link copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={downloadMidi}
                className="rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                Download .mid
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <Legend color={TRACK_COLOR.lead} label="lead" />
            <Legend color={TRACK_COLOR.pad} label="pad" />
            <Legend color={TRACK_COLOR.drone} label="drone" />
            <span className="text-gray-600">space to play · ← → to seek</span>
          </div>

          <section className="rounded-xl bg-white/[0.03] ring-1 ring-white/10">
            <button
              type="button"
              onClick={() => setSandboxOpen((o) => !o)}
              aria-expanded={sandboxOpen}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-medium text-white">Sandbox</span>
              <span className="text-xs text-gray-500">{sandboxOpen ? "hide" : "tempo · density"}</span>
            </button>

            {sandboxOpen && (
              <div className="space-y-4 border-t border-white/10 px-4 py-4">
                <Slider
                  label="Tempo"
                  value={tempo}
                  min={0.75}
                  max={1.5}
                  step={0.05}
                  format={(v) => `×${v.toFixed(2)}`}
                  onCommit={setTempo}
                  hint="Retempos the piece (same notes, new seconds-per-beat). Playback restarts."
                />
                <Slider
                  label="History density"
                  value={density}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onCommit={setDensity}
                  hint={
                    mode === "structure"
                      ? "Only affects ambient and blend. Structure mode has no history layer."
                      : "Thins the texture. 0 leaves just the drone."
                  }
                />
              </div>
            )}
          </section>
        </section>
      )}

      <HowItWorks />

      <footer className="mt-auto pt-10 text-xs text-gray-600">
        {score
          ? MODE_COPY[score.mode].blurb
          : "Deterministic by design: no randomness at render time, only hashes of your repo's name, tree and history."}
      </footer>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Local draft value so dragging never re-composes the score; the commit fires on release. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  hint,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-gray-300">{label}</span>
        <span className="font-mono text-gray-400 tabular-nums">{format(draft)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number(e.currentTarget.value))}
        onKeyUp={(e) => onCommit(Number(e.currentTarget.value))}
        className="mt-1 w-full accent-indigo-400"
      />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{hint}</p>}
    </label>
  );
}

const MAPPING: [string, string][] = [
  ["Repo name", "key and tempo (seeded, so it never changes)"],
  ["Top-level folders", "sections"],
  ["File path", "pitch"],
  ["File size", "note length"],
  ["Lines added + removed", "tension in the pad"],
  ["Commit count", "density"],
  ["Author", "stereo position"],
  ["End of history", "an 8-beat coda"],
];

function HowItWorks() {
  return (
    <section className="mt-12 border-t border-white/10 pt-6">
      <h2 className="text-sm font-medium text-white">How a repo becomes a song</h2>
      <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-xs sm:grid-cols-2">
        {MAPPING.map(([from, to]) => (
          <div key={from} className="flex items-baseline gap-2">
            <dt className="w-40 shrink-0 text-gray-500">{from}</dt>
            <dd className="text-gray-300">{to}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}