import { cn } from "@latch-protocol/ui/lib/utils";

export type ClauseState = "hold" | "captured" | "denied";

/**
 * The clause strip — the signature element of the Authorization Terminal
 * direction. Every hold and denial renders its Datalog clause verbatim as a
 * ruled mono line with a state glyph, because in Latch the proof is the
 * product: `{code, clause, expected, got}` is the one shape shared by the
 * API, the ledger, and the chat.
 */
const GLYPH: Record<ClauseState, { mark: string; className: string; label: string }> = {
  hold: { mark: "○", className: "text-muted-foreground", label: "hold" },
  captured: { mark: "●", className: "text-approve", label: "captured" },
  denied: { mark: "✕", className: "text-destructive", label: "denied" },
};

export function ClauseStrip({
  state,
  clause,
  result,
  className,
}: {
  state: ClauseState;
  clause: string;
  result?: string;
  className?: string;
}) {
  const glyph = GLYPH[state];
  return (
    <div
      data-clause-state={state}
      className={cn("flex items-baseline gap-2 border-t border-border pt-2", className)}
    >
      <span aria-hidden className={cn("shrink-0 text-[11px]", glyph.className)}>
        {glyph.mark}
      </span>
      <span className="sr-only">{glyph.label}:</span>
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
        {clause}
        {result ? (
          <span className="text-foreground">
            {"  →  "}
            {result}
          </span>
        ) : null}
      </pre>
    </div>
  );
}
