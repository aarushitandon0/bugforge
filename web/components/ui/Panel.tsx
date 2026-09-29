import type { ReactNode } from "react";

/**
 * A printed object sitting on the page: header slot, body slot, optional
 * footer slot, one thick ink border, square corners, --card-padding on all
 * three.
 *
 * Elevation is the hard offset shadow: a solid slab of ink printed behind the
 * box. The surface step still changes underneath it, so the panel reads as a
 * separate object even where the shadow is suppressed. The landing terminal,
 * the gap summary card and every solve-rail section are the same component.
 *
 * `flat` drops the shadow for panels that tile edge to edge or live inside
 * another bordered box, where a second printed shadow would just be noise.
 */
export function Panel({
  header,
  footer,
  children,
  className = "",
  bodyClassName = "",
  bodyProps,
  padded = true,
  flat = false,
  ...rest
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** the body is a live region / scroller often enough to be worth passing through */
  bodyProps?: React.ComponentProps<"div">;
  /** off when the body is a scroller that has to own its own padding */
  padded?: boolean;
  /** drop the printed shadow -- for panels nested inside another bordered box */
  flat?: boolean;
} & Omit<React.ComponentProps<"section">, "children" | "className">) {
  return (
    <section
      {...rest}
      className={`flex min-h-0 flex-col border-[3px] border-line bg-surface-2 ${flat ? "" : "shadow-brut"} ${className}`}
    >
      {header !== undefined && (
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-3 border-b-[3px] border-line p-card">
          {header}
        </div>
      )}
      <div {...bodyProps} className={`min-h-0 flex-1 ${padded ? "p-card" : ""} ${bodyClassName}`}>
        {children}
      </div>
      {footer !== undefined && <div className="shrink-0 border-t-[3px] border-line p-card">{footer}</div>}
    </section>
  );
}
