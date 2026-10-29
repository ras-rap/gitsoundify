import { useEffect, useMemo, useRef, useState } from "react";
import { scoreSeconds, type NoteEvent, type Score, type TrackId } from "../compose/score";
import { describeSource } from "../compose/source";
import { ROLL_COLOR } from "./theme";

const HEIGHT = 240;
/** Height of the band reserved for section labels at the top of the roll. */
const TOP = 24;

const COLORS: Record<TrackId, string> = {
  drone: "rgba(99, 102, 241, 0.9)",
  pad: "rgba(167, 139, 250, 0.35)",
  lead: "rgba(251, 191, 36, 0.95)",
};

/** Hit-testing priority: front-most track first, so overlapping hover targets resolve top-down. */
const HIT_ORDER: readonly TrackId[] = ["lead", "drone", "pad"];

interface Props {
  score: Score;
  /** Playhead position in seconds, clamped to the score length when drawn. */
  position: number;
  onSeek: (seconds: number) => void;
}

/**
 * Piano-roll view of a {@link Score}: section bands, per-track notes, a playhead and a hover
 * tooltip. Notes are painted on a canvas; the playhead and tooltip are DOM overlays so they can
 * be positioned by percentage and styled with CSS.
 */
export function Roll({ score, position, onSeek }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ note: NoteEvent; x: number; y: number } | null>(null);
  const total = scoreSeconds(score);

  // Track the wrapper's width rather than the window's: the roll is fluid inside the layout.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Pixel mapping for the current score: pitch range, row height and beat/pitch -> px converters. */
  const geo = useMemo(() => {
    let lo = 127;
    let hi = 0;
    for (const n of score.notes) {
      if (n.midi < lo) lo = n.midi;
      if (n.midi > hi) hi = n.midi;
    }
    if (score.notes.length === 0) { lo = 60; hi = 60; }
    const rows = hi - lo + 1;
    // Squeeze rows between 3px and 9px so wide pitch ranges still fit in HEIGHT.
    const rowH = Math.max(3, Math.min(9, (HEIGHT - TOP - 6) / rows));
    const x = (beat: number) => (beat / score.lengthBeats) * width;
    // Pitch 0 at the bottom; y() returns the top edge of the note's row.
    const y = (midi: number) => HEIGHT - 6 - ((midi - lo + 1) / rows) * (HEIGHT - TOP - 6);
    return { x, y, rowH };
  }, [score, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Size the backing store in device pixels, then scale the context so the rest of the drawing
    // code keeps working in CSS pixels.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    score.sections.forEach((s, i) => {
      // Alternate a faint wash so section boundaries are readable without grid lines.
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.035)";
        ctx.fillRect(geo.x(s.start), 0, geo.x(s.length) - geo.x(0), HEIGHT);
      }
      const w = geo.x(s.length) - geo.x(0);
      if (w > 36) {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        ctx.save();
        ctx.beginPath();
        ctx.rect(geo.x(s.start), 0, w - 4, TOP);
        ctx.clip();
        ctx.fillText(s.name, geo.x(s.start) + 6, 15);
        ctx.restore();
      }
    });

    for (const track of ["pad", "drone", "lead"] as const) {
      ctx.fillStyle = COLORS[track];
      for (const n of score.notes) {
        if (n.track !== track) continue;
        ctx.fillRect(geo.x(n.time), geo.y(n.midi), Math.max(2, geo.x(n.duration) - geo.x(0) - 1), geo.rowH);
      }
    }

    if (hover) {
      const r = noteRect(hover.note);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.left + 0.5, r.top + 0.5, r.w - 1, r.h - 1);
    }
  }, [score, width, geo, hover]);

  /** Bounding box of a note in CSS pixels; -1 keeps adjacent notes visually separated. */
  const noteRect = (n: NoteEvent) => {
    const left = geo.x(n.time);
    const w = Math.max(2, geo.x(n.duration) - geo.x(0) - 1);
    return { left, top: geo.y(n.midi), w, h: geo.rowH };
  };

  /** Topmost note under the cursor, or null. Later notes win within a track (last drawn = on top). */
  const hitTest = (px: number, py: number): NoteEvent | null => {
    for (const track of HIT_ORDER) {
      // Walk backwards: the render loop draws in array order, so later notes sit on top.
      for (let i = score.notes.length - 1; i >= 0; i--) {
        const n = score.notes[i]!;
        if (n.track !== track) continue;
        const r = noteRect(n);
        if (px >= r.left && px <= r.left + r.w && py >= r.top && py <= r.top + r.h) return n;
      }
    }
    return null;
  };

  const frac = total > 0 ? Math.min(1, position / total) : 0;
  const TIP_W = 260;
  // Flip the tooltip to the left of the cursor when it would overflow the right edge.
  const tipLeft = hover ? (hover.x + TIP_W + 16 > width ? hover.x - TIP_W - 12 : hover.x + 12) : 0;

  return (
        <div
      ref={wrapRef}
      tabIndex={0}
      role="slider"
      aria-label="Playhead position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${Math.floor(position / 60)} minutes ${Math.round(position % 60)} seconds`}
      className="relative w-full cursor-crosshair overflow-hidden rounded-lg bg-black/30 ring-1 ring-white/10 outline-none select-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      style={{ height: HEIGHT }}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const note = hitTest(px, py);
        setHover(note ? { note, x: px, y: py } : null);
      }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        // Mirrors the global arrow handler in App; without this, a focused roll would swallow keys.
        const step = e.shiftKey ? 15 : 5;
        let next: number | null = null;
        if (e.key === "ArrowLeft") next = position - step;
        else if (e.key === "ArrowRight") next = position + step;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = total;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        onSeek(Math.max(0, Math.min(total, next)));
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        // Map the click's horizontal fraction of the roll back to a time in seconds.
        onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * total);
      }}
    >
      <canvas ref={canvasRef} style={{ width, height: HEIGHT }} />
      <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.7)]" style={{ left: `${frac * 100}%` }} />

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-gray-900/95 px-2.5 py-1.5 text-xs text-gray-100 ring-1 ring-white/15"
          style={{ left: tipLeft, top: Math.min(hover.y + 12, HEIGHT - 58), width: TIP_W }}
        >
          <div className="font-medium text-white">{hover.note.track}</div>
          <div className="mt-0.5 break-all text-gray-300">{describeSource(hover.note.source)}</div>
        </div>
      )}
    </div>
  );
}