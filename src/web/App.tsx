import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compose, selectMode, type Mode } from "../compose";
import { scoreSeconds, type TrackId } from "../compose/score";
import { describeSource } from "../compose/source";
import type { RepoSnapshot } from "../extract/types";
import { Engine, TAIL_SECONDS } from "./engine";
import { formatTime, noteName } from "./format";
import { Roll } from "./Roll";

type Status = "idle" | "loading" | "ready" | "error";
type PlayState = "stopped" | "playing" | "paused";
type ModeChoice = "auto" | Mode;

const EXAMPLES = ["octocat/Hello-World", "octocat/Spoon-Knife", "swyf-modding/Switchboard"];

const TRACK_COLOR: Record<TrackId, string> = {
  drone: "rgba(99, 102, 241, 0.9)",
  pad: "rgba(167, 139, 250, 0.6)",
  lead: "rgba(251, 191, 36, 0.95)",
};

const MAX_SOUNDING = 6;

const parseMode = (params: URLSearchParams): ModeChoice => {
  const m = params.get("mode");
  return m === "structure" || m === "ambient" || m === "blend" ? m : "auto";
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
  const loadId = useRef(0);

  const mode = useMemo<Mode | null>(
    () => (snapshot ? (modeChoice === "auto" ? selectMode(snapshot.commitCount) : modeChoice) : null),
    [snapshot, modeChoice],
  );
  const score = useMemo(() => (snapshot && mode ? compose(snapshot, mode) : null), [snapshot, mode]);
  const total = score ? scoreSeconds(score) : 0;

  const load = useCallback(async (value: string) => {
    const repo = value.trim();
    if (!repo) return;
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
    } catch (e) {
      if (id !== loadId.current) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!score) return;
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
    if (playState !== "playing") return;
    let raf = 0;
    const tick = () => {
      const p = engine.position;
      setPosition(p);
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

  const toggle = async () => {
    if (!score) return;
    if (playState === "playing") {
      engine.pause();
      setPlayState("paused");
    } else {
      await engine.play();
      setPlayState("playing");
    }
  };

  const shown = Math.min(position, total);
  const beat = score ? (shown * score.bpm) / 60 : 0;

  const sounding = useMemo(() => {
    if (!score) return [];
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
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Repo to Song</h1>
        <p className="mt-1 text-sm text-gray-400">Turn any public GitHub repository into an ambient piece. Same repo, same song, every time.</p>
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
          className="min-w-0 flex-1 rounded-lg bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 ring-1 ring-white/10 outline-none focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={status === "loading" || !input.trim()}
          className="rounded-lg bg-indigo-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-40"
        >
          {status === "loading" ? "Reading…" : "Load"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setInput(ex);
              void load(ex);
            }}
            className="rounded-full bg-white/5 px-3 py-1 text-gray-300 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            {ex}
          </button>
        ))}
      </div>

      {status === "error" && <p className="mt-6 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-400/20">{error}</p>}

      {status === "loading" && <p className="mt-10 text-center text-sm text-gray-400">Cloning and reading the repository…</p>}

      {score && status !== "loading" && (
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-medium text-white">{score.name}</h2>
            <p className="text-sm text-gray-400">
              {noteName(score.key.root)} {score.key.scale} · {score.bpm} bpm · {score.notes.length} notes · {score.mode} mode
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-xs">
            {(["auto", "structure", "ambient"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModeChoice(m)}
                className={`rounded-full px-3 py-1 ring-1 transition ${
                  modeChoice === m
                    ? "bg-indigo-500/20 text-indigo-200 ring-indigo-400/40"
                    : "bg-white/5 text-gray-400 ring-white/10 hover:bg-white/10"
                }`}
              >
                {m}
              </button>
            ))}
            {snapshot && (
              <span className="ml-2 text-gray-500">
                {snapshot.commitCount} commits{modeChoice === "auto" ? ` · picked ${mode}` : ""}
              </span>
            )}
          </div>

          <Roll
            score={score}
            position={shown}
            onSeek={(t) => {
              engine.seek(t);
              setPosition(t);
            }}
          />

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

          <div className="flex items-center gap-4">
            <button
              onClick={() => void toggle()}
              aria-label={playState === "playing" ? "Pause" : "Play"}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
            >
              {playState === "playing" ? (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect x="3" y="2" width="4" height="14" rx="1" /><rect x="11" y="2" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><path d="M4 2.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 4 2.5Z" /></svg>
              )}
            </button>
            <span className="font-mono text-sm text-gray-300 tabular-nums">
              {formatTime(shown)} / {formatTime(total)}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <Legend color={TRACK_COLOR.lead} label="lead" />
              <Legend color={TRACK_COLOR.pad} label="pad" />
              <Legend color={TRACK_COLOR.drone} label="drone" />
            </span>
          </div>
        </section>
      )}

      <footer className="mt-auto pt-12 text-xs text-gray-600">
        {score?.mode === "structure"
          ? "Structure mode: each folder is a section, each file is a note. Pitch comes from the path, length from file size."
          : "History mode: commits are compressed into eras. Size drives density, churn drives tension, authors spread the stereo field."}
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