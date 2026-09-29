"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, getRepos, startForge, type Forgeable } from "@/lib/api";
import { HEADLINE, VETTED_REPOS } from "@/lib/forge-data";
import { normalizeRepoUrl, parseRepoInput, repoDisplay } from "@/lib/format";
import { rulesFor } from "@/lib/lang";
import { Cursor } from "../Cursor";
import { ForgeStream, type LocalLine } from "../ForgeStream";
import { Mascot } from "../Mascot";
import { buttonClass } from "../ui/Button";
import { HomeSections } from "./HomeSections";

/*
 * Repos worth showing that no image exists for yet. They used to render at
 * 50% opacity, which made the whole row -- including the two that DO work --
 * read as disabled and blocked the fastest path to first value. They now carry
 * the same resting style as every other chip and say what is true instead.
 */
/*
 * What is forgeable is a property of the DEPLOYED STACK, not of the build.
 * One stack carries one image and an image carries one repo, so the vetted
 * list can name repos this stack has no image for. Offering those as live
 * chips walks the reader straight into a 422; the build-time list is only
 * good for display names and languages, and GET /repos is the truth.
 */
const VETTED_BY_URL = new Map(VETTED_REPOS.map((r) => [normalizeRepoUrl(r.url), r]));

interface Chip {
  display: string;
  language: string;
}

/*
 * Only what this stack can actually forge. A repo with no image here was
 * previously listed as "not forged yet", which reads as a to-do list on the
 * landing page rather than as a property of one deployment, so it is not shown
 * at all: one stack carries one image and an image carries one repo.
 */
function chipsFor(forgeable: Forgeable[] | null): { ready: Chip[] } {
  // Until the first response lands, show the vetted list rather than an empty
  // row: it is the best guess available and it stops the row from popping in.
  if (forgeable === null) {
    return { ready: VETTED_REPOS.map((r) => ({ display: r.display, language: r.language })) };
  }
  return {
    ready: forgeable.map((f) => {
      const vetted = VETTED_BY_URL.get(normalizeRepoUrl(f.url));
      return { display: vetted?.display ?? repoDisplay(f.repo), language: vetted?.language ?? "python" };
    }),
  };
}

/* The whole pipeline in three lines. It fills the column under the input, and
 * it is the part a first-time reader actually needs: nothing here is a model
 * inventing a bug. */
const STEPS = [
  ["baseline", "run the suite once, mapping every line to the tests that cover it"],
  ["mutate", "flip one token by AST — keep it only if the suite catches it"],
  ["grade", "your patch runs against the repo's own suite. nothing else decides"],
];

function refusal(repo: string, forgeable: Forgeable[]): LocalLine[] {
  const available = forgeable.map((f) => repoDisplay(f.repo)).join(", ") || "none";
  return [
    { tone: "error", text: `✗ ${repo} has not been forged yet` },
    { tone: "dim", text: "  repos are forged from images built ahead of time, with dependencies" },
    { tone: "dim", text: "  installed on a trusted machine. nothing is cloned or installed at runtime." },
    { tone: "dim", text: `  forgeable now: ${available}` },
  ];
}

export function Landing() {
  const router = useRouter();
  const params = useSearchParams();
  const executionId = params.get("forge");

  const [input, setInput] = useState("");
  const [forgeable, setForgeable] = useState<Forgeable[] | null>(null);
  const [lines, setLines] = useState<LocalLine[]>([]);
  const [repoLabel, setRepoLabel] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getRepos()
      .then((r) => !cancelled && setForgeable(r.forgeable))
      .catch(() => !cancelled && setForgeable([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function forge(raw: string) {
    if (starting) return;
    const repo = parseRepoInput(raw);
    const command: LocalLine = { tone: "command", text: `$ forge github.com/${repo ?? raw.trim()}` };

    if (!repo) {
      setLines([command, { tone: "error", text: "✗ not a GitHub repo. expected owner/name, e.g. jd/tenacity" }]);
      if (executionId) router.replace("/", { scroll: false });
      return;
    }
    // Known list first, so a refusal is instant; the API refuses too if this list is stale.
    if (forgeable && forgeable.length > 0 && !forgeable.some((f) => normalizeRepoUrl(f.url) === repo.toLowerCase())) {
      setLines([command, ...refusal(repo, forgeable)]);
      if (executionId) router.replace("/", { scroll: false });
      return;
    }

    setStarting(true);
    setLines([command]);
    try {
      const started = await startForge(`https://github.com/${repo}`);
      setRepoLabel(repo);
      setLines([command, { tone: "dim", text: `  started ${started.execution_id}` }]);
      router.replace(`/?forge=${encodeURIComponent(started.execution_id)}`, { scroll: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const list = (error.body.forgeable as Forgeable[] | undefined) ?? forgeable ?? [];
        setLines([command, ...refusal(repo, list)]);
      } else {
        setLines([command, { tone: "error", text: `✗ ${error instanceof Error ? error.message : String(error)}` }]);
      }
    } finally {
      setStarting(false);
    }
  }

  const { ready: examples } = chipsFor(forgeable);
  const chip = buttonClass("secondary", "sm");

  return (
    <>
    {/*
     * Two columns on a wide screen: the pitch and the input on the left, the
     * stream on the right. The grid stretches both, so the stream's bottom
     * edge and the stats line at the foot of the left column resolve to the
     * same baseline instead of ending 80px apart.
     */}
    <div className="grid grid-cols-1 gap-8 pt-10 pb-6 lg:grid-cols-2 lg:gap-16 lg:pt-14">
      <section className="flex min-w-0 flex-col">
        {/* The rotated chip stack the reference sits above every headline. */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="chip animate-pop" style={{ "--chip-rot": "-2deg" } as React.CSSProperties}>
            <span aria-hidden>◆</span> real open-source repos
          </span>
          <span
            className="chip animate-pop"
            style={{ "--chip-rot": "1.5deg", animationDelay: "90ms" } as React.CSSProperties}
          >
            <span aria-hidden>▲</span> graded by the suite
          </span>
        </div>

        {/*
         * The cursor is sized in `em`, so at the display step it renders as a
         * ~100x55px slab rather than a caret. It keeps blinking -- it is the
         * app's signature -- but at a fixed pixel size that reads as a caret
         * next to 68px type instead of as a fourth word.
         */}
        <h1 className="t-display mt-6 text-text">
          Every repo is a <span className="text-coral">debugging</span>{" "}
          {/* The caret is nowrap-bound to the word it follows: on its own it
              wrapped to a line by itself and read as a stray black block. */}
          <span className="whitespace-nowrap">
            <span className="marker">gym.</span>
            <Cursor className="ml-3 !h-6 !w-3 !translate-y-0 align-middle" />
          </span>
        </h1>
        <p className="prose mt-7 max-w-[52ch] text-muted">
          Paste any public repo with a test suite. BugForge breaks it the way it would break in production, hands you
          the stack trace, and checks your fix. Nothing here was written by hand.
        </p>

        {/*
         * The input and the button are one 52px box with a shared border. The
         * button is the only filled accent on the page -- the page previously
         * had no filled control anywhere, which is what made it read as a demo
         * rather than a product.
         */}
        <form
          className="mt-7 flex flex-col border-[3px] border-line bg-surface-2 shadow-brut transition-shadow duration-[120ms] focus-within:shadow-brut-lg sm:h-14 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            forge(input);
          }}
        >
          <label className="flex min-w-0 flex-1 cursor-text items-center pl-5" htmlFor="repo-input">
            <span className="shrink-0 select-none text-[15px] text-muted">github.com/</span>
            <input
              id="repo-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="owner/repo"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="GitHub repository, as owner/repo"
              className="min-w-0 flex-1 bg-transparent py-4 pr-5 text-[15px] text-text caret-text outline-none placeholder:text-faint [caret-shape:block]"
            />
          </label>
          <button
            type="submit"
            disabled={starting}
            /* Inside the shared box the button must not carry its own shadow
               or its own outer border -- it is a segment of one control. */
            className={buttonClass(
              "primary",
              "lg",
              "shrink-0 !border-0 !border-t-[3px] !shadow-none !transform-none disabled:cursor-wait sm:h-auto sm:self-stretch sm:!border-t-0 sm:!border-l-[3px]",
            )}
          >
            {starting ? "forging…" : "forge bugs"}
          </button>
        </form>

        {/*
         * Every chip rests identically. What differs is hover, and the one
         * whose name is currently in the box -- which is the only distinction
         * that tells the reader anything.
         */}
        <div className="mt-3 flex min-h-8 flex-wrap items-center gap-2">
          {examples.length > 0 && <span className="t-small text-muted">try</span>}
          {examples.map(({ display, language }) => (
            <button
              key={display}
              type="button"
              aria-pressed={input.trim().toLowerCase() === display.toLowerCase()}
              onClick={() => {
                setInput(display);
                forge(display);
              }}
              className={buttonClass(
                "secondary",
                "sm",
                input.trim().toLowerCase() === display.toLowerCase() ? "border-line-strong bg-surface-2" : "",
              )}
            >
              {display}
              {/* The language, not decoration: picking an example is really
                  picking a language, and the two on offer behave differently
                  enough that a learner should know which one they clicked. */}
              <span className="text-muted">{rulesFor(language).label}</span>
            </button>
          ))}
        </div>

        {/*
         * The three stages as printed cards with stroked numerals, which is
         * the reference's "how a drill works" row. Each one animates in behind
         * the last so the sequence reads as a sequence.
         */}
        <ol className="mt-12 grid gap-4 border-t-[3px] border-line pt-10 sm:grid-cols-3">
          {STEPS.map(([name, what], i) => (
            <li
              key={name}
              className="brut brut-press animate-rise p-4"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="num-outline block">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="t-label mt-3 text-text">{name}</h3>
              <p className="t-small mt-2 text-muted">{what}</p>
            </li>
          ))}
        </ol>

        {/*
         * The proof that there is a filter, and not a model making bugs up.
         * Four flat colour blocks butted edge to edge under one printed
         * shadow, as the reference does with its 2 / 7 / 8 row.
         */}
        <div className="mt-auto pt-10">
          <dl className="flex flex-wrap border-[3px] border-line shadow-brut">
            {[
              { value: HEADLINE.candidates, label: "candidates", fill: "bg-surface-2 text-text" },
              { value: HEADLINE.covered, label: "on covered lines", fill: "bg-accent text-accent-fg" },
              { value: HEADLINE.admitted, label: "bugs", fill: "bg-green text-[#1a1423]" },
              { value: HEADLINE.gaps, label: "test gaps", fill: "bg-coral text-[#1a1423]" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`min-w-0 flex-1 px-3 py-3 ${stat.fill} ${i > 0 ? "border-l-[3px] border-line" : ""}`}
              >
                <dd className="font-display text-[26px] leading-none font-black tabular-nums">{stat.value}</dd>
                <dt className="t-label mt-1.5 break-words">{stat.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/*
       * A FIXED height, not a minimum.
       *
       * The Panel body is already `overflow-auto`, but `h-full` inside a
       * min-height section resolves to nothing, so the terminal grew a row at
       * a time and pushed the whole page down with it -- 120 classified rows
       * turned the hero into several screens of scroll. Pinning the height
       * gives the body something to be 100% of, and the rows scroll inside it
       * the way they would in a real terminal.
       */}
      <section aria-label="generation stream" className="relative h-[460px] min-w-0 lg:h-[640px]">
        {/*
         * The mascot straddles the terminal's BOTTOM-left corner, where the
         * stream has run out of rows and the panel is empty. It previously sat
         * on the top-left, directly over the repo name and the run id -- the
         * two bits of the header worth reading.
         *
         * Hidden below lg: at phone width it would cover the first stream rows,
         * and the stream is the thing worth seeing.
         */}
        {/*
         * Bottom-right, sized to the gap the legend leaves.
         *
         * Every other edge of the terminal is spoken for: the header carries
         * the repo and the run id, the body is where rows stream in, and the
         * footer legend runs from the left padding. What is left is the strip
         * to the right of that legend, about 130px at the narrowest width this
         * renders at, so the mascot is drawn to fit inside it rather than
         * floating over live output. It only appears from lg up, where that
         * strip exists at all.
         */}
        <Mascot className="pointer-events-none absolute right-3 -bottom-6 z-10 hidden w-[118px] animate-rise lg:block" />
        <ForgeStream executionId={executionId} repoLabel={repoLabel} localLines={lines} legend />
      </section>
    </div>

    <HomeSections />
    </>
  );
}
