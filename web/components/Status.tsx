import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "./ui/Button";
import { Cursor } from "./Cursor";

export function Loading({ text }: { text: string }) {
  return (
    <p className="py-6 text-muted" role="status">
      {text}… <Cursor className="!h-[0.95em] !w-[0.5em]" />
    </p>
  );
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p className="my-6 w-fit border-2 border-line bg-coral px-3 py-2 font-bold text-[#1a1423] shadow-brut-sm" role="alert">
      ✗ {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-4 underline decoration-2 underline-offset-4">
          retry
        </button>
      )}
    </p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  back,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  /** the way up one level, e.g. a repo page back to the repo list */
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <header className="pt-14 pb-8">
      {back && (
        <ButtonLink variant="secondary" size="sm" href={back.href} className="mb-7">
          <ArrowLeft size={14} strokeWidth={2.5} aria-hidden />
          {back.label}
        </ButtonLink>
      )}
      {/* The eyebrow is a printed chip, not a line of small text -- it is the
          reference's one consistent move above every section title. */}
      {eyebrow && (
        <p className="mb-4">
          <span className="chip" style={{ "--chip-rot": "-1.5deg" } as React.CSSProperties}>
            {eyebrow}
          </span>
        </p>
      )}
      <h1 className="t-h1 max-w-[20ch] text-text">{title}</h1>
      {children && <div className="prose mt-4 max-w-[62ch] text-muted">{children}</div>}
    </header>
  );
}
