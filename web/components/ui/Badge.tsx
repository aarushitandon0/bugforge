import type { ReactNode } from "react";

/**
 * Three kinds of badge, and the kind decides the colour treatment.
 *
 * `difficulty` is the only one that gets a colour ramp, and all three bands
 * carry one -- an uncoloured "medium" next to a green "easy" reads as a
 * missing state rather than a middle one.
 *
 * `language` is deliberately neutral: it is a fact about the repo, not a
 * judgement, and colouring it competed with the difficulty band.
 *
 * `status` borrows the terminal vocabulary (keep / drop / gap) so a verdict
 * means the same thing on a card as it does in the stream.
 */

export type DifficultyBand = "easy" | "medium" | "hard";
export type StatusKind = "keep" | "drop" | "gap";

/* Flat saturated fill, ink letterform, 2px ink border, printed shadow. The
   band is legible from the colour alone at a glance, which is the whole point
   of a badge in a grid of fifty-six. */
const BASE = "inline-flex items-center gap-1 border-2 border-line px-2 py-px shadow-brut-sm t-label";

const DIFFICULTY: Record<DifficultyBand, string> = {
  easy: "bg-green text-[#1a1423]",
  medium: "bg-accent text-accent-fg",
  hard: "bg-coral text-[#1a1423]",
};

const STATUS: Record<StatusKind, string> = {
  keep: "bg-green text-[#1a1423]",
  drop: "bg-surface-3 text-muted",
  gap: "bg-coral text-[#1a1423]",
};

export function DifficultyBadge({ band, title }: { band: DifficultyBand; title?: string }) {
  return (
    <span className={`${BASE} ${DIFFICULTY[band]}`} title={title}>
      {band}
    </span>
  );
}

export function LanguageBadge({ language }: { language: string }) {
  return <span className={`${BASE} bg-surface-2 text-text`}>{language.toLowerCase()}</span>;
}

export function StatusBadge({ kind, children }: { kind: StatusKind; children?: ReactNode }) {
  return <span className={`${BASE} ${STATUS[kind]}`}>{children ?? kind}</span>;
}
