"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiConfigured } from "@/lib/api";
import { Cursor } from "./Cursor";
import { SignIn } from "./SignIn";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "forge", match: (p: string) => p === "/" },
  { href: "/repos/", label: "repos", match: (p: string) => p.startsWith("/repos") || p.startsWith("/repo/") },
  { href: "/gaps/", label: "gaps", match: (p: string) => p.startsWith("/gaps") },
  { href: "/profile/", label: "profile", match: (p: string) => p.startsWith("/profile") },
];

export function SiteHeader({
  wide = false,
  compact = false,
  children,
}: {
  wide?: boolean;
  /** the solve screen: the same nav in a 36px bar, with room for breadcrumbs */
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const width = wide ? "max-w-[1680px]" : "max-w-[1280px]";
  return (
    <header
      className={`sticky top-0 z-40 border-b-[3px] border-line bg-surface-1 ${compact ? "!bg-surface-2" : ""}`}
    >
      {/*
       * One nav, every route. The solve screen used to substitute a back link
       * for the whole header, which meant sign-in state -- the thing that
       * decides whether a submit will be accepted -- vanished on the one
       * screen where you submit. Composition is fixed; only the box changes.
       */}
      <div
        className={
          compact
            ? "flex h-9 items-center gap-4 px-3 t-small"
            : `mx-auto flex h-16 items-center gap-6 px-5 lg:px-page ${width}`
        }
      >
        {/*
         * The wordmark as a printed lockup: an amber tile carrying the cursor
         * glyph, then the name with "forge" in coral -- the reference splits
         * its own wordmark on colour at exactly the same seam.
         */}
        <Link href="/" className="group flex shrink-0 items-center gap-3 text-text">
          <span
            className={`inline-flex items-center justify-center border-2 border-line bg-accent text-accent-fg shadow-brut-sm transition-transform duration-[120ms] group-hover:-translate-x-px group-hover:-translate-y-px ${
              compact ? "size-6" : "size-8"
            }`}
          >
            <Cursor className="!animate-none" />
          </span>
          <span
            className={`font-display font-black uppercase tracking-[-0.01em] ${compact ? "text-[13px]" : "text-[19px]"}`}
          >
            bug<span className="text-coral-text">forge</span>
          </span>
        </Link>
        {!compact && <span className="flex-1" />}
        <nav className={`flex shrink-0 gap-6 ${compact ? "gap-4" : ""}`} aria-label="primary">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`px-1 py-0.5 t-label transition-colors duration-[120ms] ${
                  active
                    ? "bg-accent text-accent-fg shadow-brut-sm border-2 border-line"
                    : "text-muted hover:text-text"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {compact && <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>}
        <div className="flex shrink-0 items-center gap-6">
          <SignIn />
          <ThemeToggle />
        </div>
      </div>
      {!apiConfigured && (
        <div className="border-t-[3px] border-line bg-coral text-[#1a1423]">
          <p
            className={
              compact
                ? "px-3 py-2 t-label"
                : `mx-auto px-5 py-2 t-label lg:px-page ${width}`
            }
          >
            ! NEXT_PUBLIC_API_URL was not set when this site was built. Nothing can load.
          </p>
        </div>
      )}
    </header>
  );
}

/**
 * `wide` gives the landing page room for a two-column hero; the reading pages
 * stay at 1120px, which is about as wide as a line of 13px mono should get.
 */
export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const width = wide ? "max-w-[1680px]" : "max-w-[1280px]";
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader wide={wide} />
      <main className={`mx-auto w-full flex-1 px-5 lg:px-page ${width} ${wide ? "pb-10" : "pb-20"}`}>{children}</main>
      {/* The dark rule the reference closes on: ink bar, amber caption. */}
      <footer className="mt-auto border-t-[3px] border-line bg-slab text-slab-text no-grid">
        <div
          className={`mx-auto flex flex-wrap items-center justify-between gap-3 px-5 py-5 t-label lg:px-page ${width}`}
        >
          <p>bugforge / bugs by AST / graded by the repo&apos;s own suite</p>
          <p className="text-accent">nothing here was written by hand.</p>
        </div>
      </footer>
    </div>
  );
}
