"use client";

/**
 * The account screen: one route that is a sign-in page when you are signed
 * out and a sign-out page when you are signed in.
 *
 * It owns no auth logic. `useSession` is the same hook the header uses, so
 * this page cannot disagree with the control in the corner -- they read one
 * shared, cached answer to GET /auth/me.
 *
 * The three reasons are stated plainly rather than sold. Signing in buys
 * attribution and cross-device progress and nothing else; browsing, reading a
 * traceback and editing a patch all work signed out, and a page that implies
 * otherwise would be lying.
 */

import { ArrowRight, Check, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiConfigured } from "@/lib/api";
import { consumeAuthParams, useSession } from "@/lib/session";
import { Mascot } from "../Mascot";
import { Button, ButtonLink } from "../ui/Button";

/**
 * The GitHub mark, inline -- lucide-react dropped its brand icons, and this is
 * the one place a recognisable logo does real work.
 */
function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** What an account actually buys, in the order it starts mattering. */
const REASONS = [
  {
    icon: Check,
    title: "solves are recorded as yours",
    body: "A passing patch is attributed to your account and counts on the leaderboard, scored by summed difficulty.",
  },
  {
    icon: MonitorSmartphone,
    title: "progress follows you",
    body: "Anything you solved signed out is merged into your account, never replaced. Solve on a laptop, carry on from a phone.",
  },
  {
    icon: ShieldCheck,
    title: "nothing else changes",
    body: "Browsing, reading a traceback and editing a patch all work signed out. The suite grades you either way.",
  },
];

/** A stack of three printed rows, each arriving behind the last. */
function Reasons() {
  return (
    <ul className="mt-10 grid gap-3">
      {REASONS.map(({ icon: Icon, title, body }, i) => (
        <li
          key={title}
          className="brut brut-press animate-rise flex gap-4 p-4"
          style={{ animationDelay: `${140 + i * 90}ms` }}
        >
          <span className="flex size-9 shrink-0 items-center justify-center border-2 border-line bg-accent text-accent-fg shadow-brut-sm">
            <Icon size={17} strokeWidth={2.5} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="t-label text-text">{title}</h2>
            <p className="t-small mt-1.5 text-muted">{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The card's top strip. Three dots and a caption, so the panel reads as the
 * same object as the forge terminal on the landing page.
 */
function CardBar({ caption, live = false }: { caption: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b-[3px] border-line bg-surface-3 px-4 py-2.5">
      <span className="flex gap-1.5" aria-hidden>
        <span className="size-2.5 border border-line bg-coral" />
        <span className="size-2.5 border border-line bg-accent" />
        <span className="size-2.5 border border-line bg-green" />
      </span>
      <span className="t-label truncate text-text">{caption}</span>
      {live && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 t-label text-text">
          <span className="size-2 animate-pulse-dot bg-green" aria-hidden />
          active
        </span>
      )}
    </div>
  );
}

export function Auth() {
  const { user, loading, signIn, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /* The OAuth callback lands back here with ?signed_in=1 or ?auth_error=... .
     Stripping them keeps a reload from replaying the banner. */
  useEffect(() => {
    const { signedIn, error: err } = consumeAuthParams();
    setError(err);
    setJustSignedIn(signedIn);
  }, []);

  /* A stack built without an API cannot sign anyone in, and a button that
     always fails is worse than an explanation. */
  if (!apiConfigured) {
    return (
      <div className="py-24">
        <span className="chip" style={{ "--chip-rot": "-1.5deg" } as React.CSSProperties}>
          account
        </span>
        <h1 className="t-h1 mt-6 text-text">Sign-in is not configured.</h1>
        <p className="prose mt-4 max-w-[54ch] text-muted">
          This build has no API URL, so there is nothing to authenticate against. Everything else on the site still
          works — solves are kept in this browser.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-10 pt-12 pb-10 lg:grid-cols-2 lg:gap-16">
      {/* ---- left: what this is ------------------------------------------ */}
      <section className="min-w-0">
        <span className="chip animate-pop" style={{ "--chip-rot": "-2deg" } as React.CSSProperties}>
          <span aria-hidden>◆</span> account
        </span>

        <h1 className="t-display mt-6 text-text">
          {user ? (
            <>
              Signed in as <span className="marker">{user.login}</span>
            </>
          ) : (
            <>
              Keep your <span className="text-coral">solves.</span>
            </>
          )}
        </h1>

        <p className="prose mt-6 max-w-[52ch] text-muted">
          {user
            ? "Your solves are recorded against this account and follow you between devices. Signing out leaves everything on this site working — progress just goes back to living in this browser."
            : "One GitHub account, and a passing patch stops being something only this browser remembers."}
        </p>

        <Reasons />
      </section>

      {/* ---- right: the control ------------------------------------------ */}
      <section className="relative min-w-0 animate-rise lg:pt-2">
        {error && (
          <p
            role="alert"
            className="mb-4 animate-pop border-2 border-line bg-coral px-3 py-2 font-bold text-[#1a1423] shadow-brut-sm"
          >
            ✗ {error}
          </p>
        )}

        {loading ? (
          /* Hold the box rather than flashing the signed-out card before the
             answer arrives -- this page's whole content depends on it. */
          <div className="brut" aria-busy="true">
            <CardBar caption="checking session" />
            <div className="flex items-center gap-3 p-10 t-small text-muted">
              <span className="size-2.5 animate-pulse-dot bg-accent" aria-hidden />
              asking the API who you are…
            </div>
          </div>
        ) : user ? (
          <div className="brut">
            <CardBar caption="session" live />
            <div className="p-6">
              {justSignedIn && (
                <p className="mb-5 flex w-fit animate-pop items-center gap-2 border-2 border-line bg-green px-2 py-px t-label text-[#1a1423] shadow-brut-sm">
                  <Check size={13} strokeWidth={3} aria-hidden /> signed in
                </p>
              )}

              <div className="flex items-center gap-4">
                {user.avatar_url ? (
                  /* A plain <img>: avatar hosts are arbitrary, and next/image
                     would need every GitHub CDN host allowlisted. */
                  <img
                    src={user.avatar_url}
                    alt=""
                    width={64}
                    height={64}
                    className="size-16 shrink-0 border-[3px] border-line shadow-brut-sm"
                  />
                ) : (
                  <span className="flex size-16 shrink-0 items-center justify-center border-[3px] border-line bg-accent text-[26px] font-black text-accent-fg shadow-brut-sm">
                    {user.login.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="font-display text-[24px] leading-none font-black break-words uppercase text-text">
                    {user.login}
                  </p>
                  <p className="t-label mt-2 text-muted">authenticated with github</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 border-t-[3px] border-line pt-6 sm:grid-cols-2">
                <ButtonLink href="/profile/" variant="primary" size="md" className="w-full">
                  your record
                  <ArrowRight size={14} strokeWidth={3} aria-hidden />
                </ButtonLink>
                <Button
                  variant="secondary"
                  size="md"
                  className="w-full"
                  disabled={leaving}
                  onClick={() => {
                    setLeaving(true);
                    /* useSession publishes null when the cookie is gone, which
                       re-renders this card as the signed-out one. */
                    void signOut().finally(() => setLeaving(false));
                  }}
                >
                  <LogOut size={14} strokeWidth={2.5} aria-hidden />
                  {leaving ? "signing out…" : "sign out"}
                </Button>
              </div>

              <p className="t-small mt-5 text-muted">
                Signing out clears the session cookie for this site. Your solved bugs stay on the account and come back
                the next time you sign in.
              </p>
            </div>
          </div>
        ) : (
          <div className="brut">
            <CardBar caption="sign in" />
            <div className="p-6">
              <Button variant="primary" size="lg" className="w-full" onClick={signIn}>
                <GithubMark />
                continue with github
              </Button>

              <p className="t-small mt-4 text-muted">
                You are sent to github.com to approve, then straight back here. BugForge reads your login and avatar,
                and nothing else.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t-[3px] border-line pt-6">
                <Link href="/repos/" className="link">
                  keep browsing signed out
                </Link>
                <span className="t-small text-muted">— every challenge is readable either way.</span>
              </div>
            </div>
          </div>
        )}

        {/* The mascot leans on the card's bottom-right, clear of its text. */}
        <Mascot className="pointer-events-none absolute -right-4 -bottom-16 z-10 hidden w-[124px] animate-rise lg:block" />
      </section>
    </div>
  );
}
