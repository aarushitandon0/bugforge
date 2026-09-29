"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The only three button treatments in the app.
 *
 * Before this there were nine, none of them filled, which is why no page ever
 * committed to a primary action. `primary` is a filled accent and there should
 * be at most one per screen; `secondary` is the bordered default; `ghost` is
 * text that happens to be clickable.
 *
 * Hover is the brutalist press: the box slides up-left out of its printed
 * shadow, and on :active it drops back down into it. Focus is the global ink
 * ring at 2px offset, so nothing here sets `outline-none`.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  /* Amber is a fill and ink sits on it: the accent measures 1.8:1 as text on
     cream, so it can never be the letterform here. */
  primary: "brut brut-press !bg-accent text-accent-fg hover:!bg-accent-hover disabled:!bg-accent/50",
  secondary: "brut brut-press !bg-surface-2 text-text hover:!bg-surface-3 disabled:text-muted",
  ghost:
    "text-text underline decoration-2 underline-offset-4 hover:bg-accent hover:text-accent-fg disabled:text-muted disabled:no-underline",
};

/* Heights are fixed so a row of mixed variants lines up on both edges. The
   ghost variant carries no box, so it takes padding but not a height. */
const SIZE: Record<ButtonSize, string> = {
  lg: "h-13 px-6 text-[14px]",
  md: "h-11 px-5 text-[12px]",
  sm: "h-9 px-4 text-[11px]",
};

const GHOST_SIZE: Record<ButtonSize, string> = {
  lg: "text-[14px]",
  md: "text-[12px]",
  sm: "text-[11px]",
};

export function buttonClass(variant: ButtonVariant, size: ButtonSize, className = ""): string {
  /* Every button is an uppercase slug: the reference has no sentence-case
     CTAs, and the tracking is what keeps a short word from looking cramped
     inside a thick border. */
  const type = "font-bold uppercase tracking-[0.12em]";
  const box =
    variant === "ghost"
      ? `inline-flex items-center gap-2 ${GHOST_SIZE[size]}`
      : `inline-flex items-center justify-center gap-2 whitespace-nowrap ${SIZE[size]}`;
  return `${box} ${type} ${VARIANT[variant]} disabled:cursor-not-allowed disabled:shadow-brut-sm ${className}`;
}

type ButtonProps = Omit<ComponentProps<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** ghost only: the trailing arrow that marks a forward move */
  arrow?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  arrow = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type="button" {...rest} className={buttonClass(variant, size, className)}>
      {children}
      {arrow && <span aria-hidden>&rarr;</span>}
    </button>
  );
}

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: boolean;
  children: ReactNode;
};

/** The same three treatments, on a link. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  arrow = false,
  className = "",
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {children}
      {arrow && <span aria-hidden>&rarr;</span>}
    </Link>
  );
}
