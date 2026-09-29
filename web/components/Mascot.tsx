/**
 * The mascot: a beetle holding a magnifying glass, standing on a terminal.
 *
 * The reference's hero carries a character, and a debugging tool has an
 * obvious one -- the bug you are hunting, looking for itself. It is drawn in
 * the same grammar as the rest of the system: flat saturated fills, thick ink
 * strokes, square joins where the shape allows, and no gradients anywhere, so
 * it survives both themes by keeping every stroke on `--border` and every fill
 * on a palette token.
 *
 * Inline SVG rather than a file: it has to re-colour with the theme, and a
 * <img> cannot read the tokens.
 */
export function Mascot({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 250"
      role="img"
      aria-label="A beetle holding a magnifying glass, standing on a terminal window"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        stroke="var(--border)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      >
        {/* ---- the terminal it stands on -------------------------------- */}
        <rect x="18" y="176" width="204" height="60" fill="var(--surface-2)" />
        <path d="M18 196h204" />
        <circle cx="34" cy="186" r="4" fill="var(--coral)" strokeWidth="3" />
        <circle cx="50" cy="186" r="4" fill="var(--accent)" strokeWidth="3" />
        <circle cx="66" cy="186" r="4" fill="var(--green)" strokeWidth="3" />
        {/* a prompt and a caret, because the suite is what grades you */}
        <path d="M34 216l10 7-10 7" strokeWidth="4" />
        <path d="M56 223h34" strokeWidth="4" />
        <rect x="104" y="214" width="9" height="18" fill="var(--accent)" strokeWidth="3" />

        {/* ---- legs, behind the body ------------------------------------ */}
        <path d="M78 106L44 88M74 132H36M78 158l-32 20" />
        <path d="M162 106l30-16M166 132h32" />

        {/* ---- shell ----------------------------------------------------- */}
        <ellipse cx="120" cy="132" rx="46" ry="44" fill="var(--accent)" />
        {/* the wing seam */}
        <path d="M120 90v86" strokeWidth="4" />
        <circle cx="97" cy="120" r="8" fill="var(--coral)" strokeWidth="4" />
        <circle cx="143" cy="145" r="7" fill="var(--coral)" strokeWidth="4" />
        <circle cx="140" cy="112" r="5" fill="var(--violet)" strokeWidth="4" />

        {/* ---- head ------------------------------------------------------ */}
        <circle cx="120" cy="66" r="26" fill="var(--surface-2)" />
        <path d="M104 46L92 26M136 46l12-20" strokeWidth="4" />
        <circle cx="92" cy="22" r="5" fill="var(--coral)" strokeWidth="3" />
        <circle cx="148" cy="22" r="5" fill="var(--coral)" strokeWidth="3" />
        {/* eyes: one squinting through the glass, which is the whole joke */}
        <circle cx="110" cy="64" r="4" fill="var(--border)" stroke="none" />
        <path d="M128 64h12" strokeWidth="4" />
        <path d="M112 80c6 4 12 4 18 0" strokeWidth="4" />

        {/* ---- the magnifying glass -------------------------------------- */}
        <path d="M170 186l22-26" strokeWidth="9" />
        <circle cx="180" cy="120" r="30" fill="var(--violet)" fillOpacity="0.22" />
        <circle cx="180" cy="120" r="30" />
        {/* the glint */}
        <path d="M168 106a16 16 0 0 1 10-6" strokeWidth="4" stroke="var(--surface-2)" />
      </g>
    </svg>
  );
}
