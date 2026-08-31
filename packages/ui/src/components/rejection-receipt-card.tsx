import { ShieldX } from "lucide-react";

import { Bubble, BubbleContent } from "@latch-protocol/ui/components/bubble";
import { cn } from "@latch-protocol/ui/lib/utils";
import type { RejectionReceipt } from "@latch-protocol/core";

/**
 * The rejection receipt as it appears in the chat (issue #5, the
 * fail-gracefully beat). One shape, three surfaces — the API error body, the
 * ledger's `rejections` row, and this card — all consuming the SAME
 * `RejectionReceipt` type exported by `@latch-protocol/core` (no drifted copy).
 *
 *   { code, message, clause, expected, got }
 *
 * The card shows the verdict, the story line, the mismatch as expected/got
 * rows, and the failing check verbatim as the proof — a rejection is a story,
 * not a 403.
 */

function RejectionReceiptCard({
  receipt,
  align = "start",
  className,
}: {
  receipt: RejectionReceipt;
  align?: "start" | "end";
  className?: string;
}) {
  // The message's first sentence is the headline; the remainder repeats the
  // expected/got prose shown in the rows below.
  const headline = receipt.message.split(". ")[0] ?? receipt.code;

  return (
    <Bubble variant="destructive" align={align} className={cn("w-full max-w-full", className)}>
      <BubbleContent className="w-full max-w-full">
        <div className="flex items-center gap-1.5 font-medium">
          <ShieldX className="size-3.5 shrink-0" aria-hidden />
          <span>REJECTED</span>
          <span className="text-[10px] tracking-wide text-destructive/70 uppercase">
            {receipt.code}
          </span>
        </div>
        <div className="text-foreground">{headline}</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-foreground/90">
          <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">Expected</dt>
          <dd className="wrap-break-word font-mono">{receipt.expected}</dd>
          <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">Got</dt>
          <dd className="wrap-break-word font-mono">{receipt.got}</dd>
        </dl>
        <div className="mt-0.5 border-t border-destructive/20 pt-1.5">
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
            failing check
          </div>
          <pre className="mt-0.5 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
            {receipt.clause}
          </pre>
        </div>
      </BubbleContent>
    </Bubble>
  );
}

export { RejectionReceiptCard };
// The receipt shape re-exported for card consumers: one definition, in core.
export type { RejectionReceipt } from "@latch-protocol/core";
