"use client";

/**
 * Everything on the home page below the hero.
 *
 * Kept out of Landing.tsx on purpose: Landing owns the forge form and the
 * stream, which is real state and real requests, and none of this does. These
 * are static sections, so they carry no hooks and nothing here can affect the
 * page's behaviour.
 *
 * Every number and every claim below is taken from the pipeline as it is
 * actually built -- the operator table, the score weights and the grading
 * rules are the ones in bugforge/mutate.py, bugforge/select.py and
 * cloud/handlers/fn_grade.py. Nothing is aspirational.
 */

import { Cpu, Lock, ShieldCheck } from "lucide-react";
import { Mascot } from "../Mascot";
import { ButtonLink } from "../ui/Button";

/** A section heading: the printed chip, then the display-face title. */
function SectionHead({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="reveal-side min-w-0">
        <span className="chip" style={{ "--chip-rot": "-1.5deg" } as React.CSSProperties}>
          {eyebrow}
        </span>
        <h2 className="t-h1 mt-5 max-w-[18ch] text-text">{title}</h2>
      </div>
      {aside && <p className="reveal prose max-w-[42ch] text-muted">{aside}</p>}
    </div>
  );
}

/* The stages the Step Functions definition actually runs, in order. The two
   choice states (AnyCandidates, ScoringComplete) are branches rather than
   work, so they are not cards. */
const STAGES = [
  ["baseline", "Run the suite once under coverage and build a line-to-tests map: for every executable line, which tests execute it."],
  ["generate", "Walk the AST and collect mutation sites, but only on lines the baseline proved are covered. Cut into batches of ~15."],
  ["run batches", "A Distributed Map fans the batches out. Each worker runs only the tests the baseline says cover that line."],
  ["score", "Every mutation lands in exactly one of six outcomes. Caught and interesting is a challenge; caught by nothing is a test gap."],
  ["describe", "The one model call in the system writes a bug-ticket title. A post-check in code rejects any output naming the answer."],
  ["persist", "Package the broken tree, write the rows, and upload the public tree and the sealed answer under two separate IAM policies."],
];


/* The three inputs to the score in bugforge/select.py, with their real
   weights. Displacement is weighted highest because it is the thing being
   trained. */
const WEIGHTS = [
  {
    pct: 45,
    name: "displacement",
    body: "Stack frames between where the test fails and where the bug is. A traceback that points straight at the bug is a typo hunt.",
  },
  {
    pct: 25,
    name: "search space",
    body: "How many source files the failing test executes. Every one of them is a place the defect could be hiding.",
  },
  {
    pct: 30,
    name: "noise",
    body: "Inverted on purpose. Half the suite going red hands you the answer; one quiet failure gives you far less to triangulate from.",
  },
];

/* cloud/describe.py is the only module that writes prose, and it decides
   nothing. These three are what actually decide. */
const GUARANTEES = [
  {
    icon: Cpu,
    title: "bugs by AST",
    body: "Every mutation is a single token flipped in the syntax tree, and it only becomes a challenge if the repository's own suite catches it. No model invents a bug.",
  },
  {
    icon: ShieldCheck,
    title: "graded by the suite",
    body: "Your patch runs against the full suite, not just the failing test. All green is a pass. There is no rubric, no hidden test and no model in the grading path.",
  },
  {
    icon: Lock,
    title: "the answer is sealed",
    body: "The grading function has no IAM permission to read the answers prefix at all. It does not need one: a green suite is itself the proof.",
  },
];

export function HomeSections() {
  return (
    <>
      {/* ---- how a forge run works ------------------------------------- */}
      <section className="border-t-[3px] border-line pt-16 pb-20" aria-labelledby="how">
        <SectionHead
          eyebrow="the pipeline"
          title={<span id="how">How a forge run works</span>}
          aside="Eight stages on Step Functions, against one container image with the repository and its full test dependencies baked in at build time. Nothing is cloned or installed at request time."
        />

        <ol className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {STAGES.map(([name, body], i) => (
            <li key={name} className="brut brut-press reveal-stamp p-5">
              <span className="num-outline block">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="t-label mt-4 text-text">{name}</h3>
              <p className="t-small mt-2 text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- difficulty ------------------------------------------------- */}
      <section className="border-t-[3px] border-line pt-16 pb-20" aria-labelledby="hard">
        <SectionHead
          eyebrow="measured, not guessed"
          title={<span id="hard">Difficulty is three numbers</span>}
          aside="Each is measured before anyone sees the challenge, and the bands are cut from each repository's own distribution rather than at fixed thresholds."
        />

        <dl className="mt-10 grid gap-4 lg:grid-cols-3">
          {WEIGHTS.map((w, i) => (
            <div key={w.name} className="brut brut-press reveal-stamp p-5">
              <div className="flex items-baseline gap-3">
                <span className="font-display text-[40px] leading-none font-black tabular-nums text-text">
                  {w.pct}
                  <span className="text-[22px]">%</span>
                </span>
                <dt className="t-label text-text">{w.name}</dt>
              </div>
              {/* the weight, drawn -- a gauge in a thick ink tube */}
              <div className="mt-4 h-[14px] w-full border-2 border-line bg-surface-3">
                <div className="h-full bg-accent" style={{ width: `${w.pct}%` }} />
              </div>
              <dd className="t-small mt-3 text-muted">{w.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- the slab: what decides ------------------------------------- */}
      <section className="pb-20" aria-labelledby="decides">
        <div className="slab no-grid p-8 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <div className="reveal-side min-w-0">
              <span className="inline-block border-2 border-line bg-accent px-3 py-1 t-label text-accent-fg shadow-brut-sm">
                no model grades you
              </span>
              <h2 id="decides" className="t-h1 mt-6 text-slab-text">
                Nothing here was <span className="text-accent">written by hand.</span>
              </h2>
              <p className="prose mt-5 max-w-[46ch] text-slab-text/70">
                Everything that decides anything — which mutation is made, which becomes a challenge, how hard it is,
                and whether your fix is correct — is AST work and test execution.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {GUARANTEES.map(({ icon: Icon, title, body }, i) => (
                <div
                  key={title}
                  className="reveal border-2 p-5"
                >
                  <Icon size={24} strokeWidth={2} className="text-accent" aria-hidden />
                  <h3 className="t-label mt-4 text-accent">{title}</h3>
                  <p className="t-small mt-2 text-slab-text/70">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- closing call to action ------------------------------------- */}
      <section className="border-t-[3px] border-line pt-16 pb-8" aria-labelledby="start">
        <div className="flex flex-wrap items-center justify-between gap-10">
          <div className="reveal-side min-w-0">
            <h2 id="start" className="t-display text-text">
              Pick a repo.
              <br />
              <span className="text-coral">Find the bug.</span>
            </h2>
            <p className="prose mt-6 max-w-[48ch] text-muted">
              Fifty-six bugs are already forged and waiting, ordered easiest first. The suite decides when you are done.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            {/* The mascot finally gets room to be a mascot: the hero has none,
                and this is the one block with nothing to collide with. */}
            <Mascot className="pointer-events-none hidden w-[190px] shrink-0 reveal md:block" />
            <div className="flex flex-col gap-3">
              <ButtonLink href="/repos/" variant="primary" size="lg" arrow>
                browse the bugs
              </ButtonLink>
              <ButtonLink href="/gaps/" variant="secondary" size="lg">
                see the test gaps
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
