import { compose, selectMode } from "../src/compose";
import type { RepoSnapshot } from "../src/extract/types";
import { noteName } from "../src/web/format";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** 11px monospace is exactly 0.6em per glyph, so width is computable instead of guessed. */
const CHAR_W = 6.6;
const PAD = 9;

export function badgeSvg(label: string, value: string, color = "#6366f1"): string {
  const lw = Math.round(label.length * CHAR_W) + PAD * 2;
  const vw = Math.round(value.length * CHAR_W) + PAD * 2;
  const w = lw + vw;
  const a11y = `${escapeXml(label)}: ${escapeXml(value)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" viewBox="0 0 ${w} 20" role="img" aria-label="${a11y}">
  <title>${a11y}</title>
  <rect width="${lw}" height="20" rx="3" fill="#18181b"/>
  <rect x="${lw}" width="${vw}" height="20" rx="3" fill="${color}"/>
  <rect x="${lw - 3}" width="6" height="20" fill="${color}"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11">
    <text x="${lw / 2}" y="14" text-anchor="middle" fill="#a1a1aa">${escapeXml(label)}</text>
    <text x="${lw + vw / 2}" y="14" text-anchor="middle" fill="#ffffff">${escapeXml(value)}</text>
  </g>
</svg>`;
}

/** Everything the badge needs, derived from a snapshot. Key/bpm are seeded by repo name, so this is stable. */
export function badgeFor(snap: RepoSnapshot, pinned?: string): string {
  const mode = pinned === "structure" || pinned === "ambient" || pinned === "blend" ? pinned : selectMode(snap.commitCount);
  const score = compose(snap, mode);
  const value = `${noteName(score.key.root)} ${score.key.scale} · ${score.bpm} bpm · ${score.mode}`;
  return badgeSvg("gitsoundify", value);
}