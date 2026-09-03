import { useEffect } from "react";
import { ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";

export type PrototypeVariantOption = {
  key: string;
  label: string;
};

/**
 * PROTOTYPE switcher (throwaway, #23). Floating bottom bar that flips the
 * `?variant=` search param. Hidden in production builds so a stray merge
 * can't ship it. Arrow keys cycle unless typing in a field.
 */
export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: PrototypeVariantOption[];
  current: string;
}) {
  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const prev = variants[(idx - 1 + variants.length) % variants.length];
  const next = variants[(idx + 1) % variants.length];
  const active = variants[idx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" && prev) window.location.search = `?variant=${prev.key}`;
      if (e.key === "ArrowRight" && next) window.location.search = `?variant=${next.key}`;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  if (import.meta.env.PROD) return null;
  if (!prev || !next || !active) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary py-1 pr-4 pl-1 text-primary-foreground shadow-lg">
      <span className="flex items-center gap-1 px-2 font-mono text-[10px] tracking-widest uppercase opacity-70">
        <FlaskConical className="size-3" aria-hidden />
        proto
      </span>
      <a
        href={`?variant=${prev.key}`}
        aria-label={`Previous variant (${prev.label})`}
        className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/15"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </a>
      <span className="min-w-44 text-center text-xs font-medium">
        {active.key} <span className="opacity-60">· {active.label}</span>
      </span>
      <a
        href={`?variant=${next.key}`}
        aria-label={`Next variant (${next.label})`}
        className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/15"
      >
        <ChevronRight className="size-4" aria-hidden />
      </a>
    </div>
  );
}
