"use client";

import Link from "next/link";
import type { ChallengeCard as Card, DifficultyLabel } from "@/lib/api";
import { plural } from "@/lib/format";
import { DifficultyBadge, LanguageBadge } from "./ui/Badge";
import { ArrowText } from "./ui/ArrowLink";

export const LABEL_COLOR: Record<DifficultyLabel, string> = {
  easy: "text-keep",
  medium: "text-count",
  hard: "text-gap",
};

export function solveHref(challengeId: string): string {
  return `/solve/?id=${encodeURIComponent(challengeId)}`;
}

/**
 * The three difficulty inputs, as a sentence.
 *
 * They used to render as three sparklines on the card face, which made them
 * the highest-contrast mark on a 56-card grid while telling a reader nothing
 * they could act on. The measurements are not gone -- the solve screen still
 * draws the bars with their tooltips, where you are actually deciding how to
 * attack the bug -- but here they ride along on the difficulty badge instead
 * of competing with the title.
 */
function breakdownTitle(card: Card): string {
  const b = card.breakdown;
  if (!b) return `difficulty ${card.difficulty_label}`;
  const displacement =
    b.displacement >= 4 ? "4+ frames from the failure" : `${plural(b.displacement, "frame")} from the failure`;
  return [
    `difficulty ${card.difficulty_label} · score ${card.difficulty_score.toFixed(1)}`,
    `displacement: ${displacement}`,
    `search space: ${plural(b.search_space, "source file")} executed`,
    `noise: ${card.failing_test_count} of ${plural(card.total_tests, "test")} red`,
  ].join("\n");
}

export function ChallengeCard({
  card,
  index,
  marker,
}: {
  card: Card;
  index?: number;
  marker?: "solved" | "next";
}) {
  const next = marker === "next";
  return (
    /*
     * Badge row, title, failure line, arrow -- top to bottom, one column, no
     * competing element to the right of the title. The whole card is the link;
     * nothing inside it is separately clickable any more, so the stretched
     * overlay has nothing to sit above.
     */
    <article
      className={`group brut brut-press relative flex h-full flex-col gap-2 p-4 ${
        next
          ? "pl-6 before:absolute before:inset-y-0 before:left-0 before:w-3 before:border-r-[3px] before:border-line before:bg-accent before:content-['']"
          : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {index !== undefined && (
          <span className="t-label tabular-nums text-text opacity-45">{String(index).padStart(2, "0")}</span>
        )}
        <DifficultyBadge band={card.difficulty_label} title={breakdownTitle(card)} />
        <LanguageBadge language={card.language} />
      </div>

      <h3 className="t-h2 min-w-0 break-words text-text">
        <Link href={solveHref(card.challenge_id)} className="after:absolute after:inset-0 after:content-['']">
          {card.title || "untitled"}
        </Link>
      </h3>

      <p className="t-small min-w-0 flex-1 break-words text-muted">{card.description}</p>

      {marker === "solved" ? (
        <span className="t-label inline-flex w-fit items-center gap-1 border-2 border-line bg-green px-2 py-px text-[#1a1423] shadow-brut-sm">
          &#10003; solved
        </span>
      ) : (
        <ArrowText tone={next ? "font-bold text-text" : "text-muted group-hover:text-text"}>
          {next ? "next up" : "solve"}
        </ArrowText>
      )}
    </article>
  );
}
