import { AMBIENT_MIN, STRUCTURE_MAX, type Mode } from "../compose";

export type ModeChoice = "auto" | Mode;

/** Chip order: auto first, then the concrete modes, with blend where the ramp actually happens. */
export const MODE_ORDER: readonly ModeChoice[] = ["auto", "structure", "blend", "ambient"];

export const isModeChoice = (v: string | null): v is ModeChoice =>
  v === "auto" || v === "structure" || v === "blend" || v === "ambient";

/**
 * Copy is derived from the composer thresholds so it cannot drift from `selectMode`.
 * `blurb` explains the mapping; `best` says when to reach for it.
 */
export const MODE_COPY: Record<ModeChoice, { label: string; blurb: string; best: string }> = {
  auto: {
    label: "Auto",
    blurb: `Picked from history size: under ${STRUCTURE_MAX} commits → structure, ${STRUCTURE_MAX}–${AMBIENT_MIN} → blend, over ${AMBIENT_MIN} → ambient.`,
    best: "The default. Always right for a first listen.",
  },
  structure: {
    label: "Structure",
    blurb: "Top-level folders become sections and each file becomes a note. Pitch comes from the path, length from the file's size.",
    best: "Small repos with few commits.",
  },
  blend: {
    label: "Blend",
    blurb: "Structure's skeleton with ambient's texture, weighted by commit count.",
    best: `Mid-sized repos (${STRUCTURE_MAX}–${AMBIENT_MIN} commits).`,
  },
  ambient: {
    label: "Ambient",
    blurb: "Commits are compressed into eras. Churn drives tension, size drives density, authors spread the stereo field.",
    best: "Long histories.",
  },
};