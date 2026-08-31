import { createFileRoute } from "@tanstack/react-router";

import {
  RejectionReceiptCard,
  type RejectionReceipt,
} from "@latch-protocol/ui/components/rejection-receipt-card";

export const Route = createFileRoute("/rejections")({
  component: RejectionsComponent,
});

/**
 * The fail-gracefully beat (issue #5): every denial — the edge verifier's, the
 * hold gate's, the tampered order's — tells the same story. These are the three
 * receipts the demo films, in the exact shape /v1/holds returns and the ledger
 * records.
 */
const BEATS: { narration: string; receipt: RejectionReceipt }[] = [
  {
    narration:
      "Act 2 — the agent's UPI Lite capability is capped at ₹500 per transaction. The order asks ₹510: the amount_cap clause names both sides.",
    receipt: {
      code: "AmountCapExceeded",
      message:
        "Per-Transaction Cap Exceeded. Expected: at most ₹500.00, Got: ₹510.00 (committed spot)",
      clause: "check if amount_cap($c), spot($s), $s <= $c",
      expected: "at most ₹500.00",
      got: "₹510.00 (committed spot)",
    },
  },
  {
    narration:
      "A swarm capability presented at the wrong merchant — the audience binding names the bound and the presented merchant.",
    receipt: {
      code: "AudienceMismatch",
      message: "Merchant Mismatch. Expected: mer_sneakerhead, Got: mer_evil",
      clause: "check if merchant($m), request_merchant($r), $r == $m",
      expected: "mer_sneakerhead",
      got: "mer_evil",
    },
  },
  {
    narration:
      "Act 3 — the malicious merchant script swaps ₹6,000 for ₹7,000 on the approved step-up. The intent binding hard-fails: the pinned digest and this request's digest are both on the receipt.",
    receipt: {
      code: "IntentMismatch",
      message:
        "Intent Hash Mismatch. Expected: 3f79bb7b435e… (the committed spend), Got: 894fb35022b7… (this request)",
      clause: "check if intent($i), request_digest($d), $d == $i",
      expected: "3f79bb7b435e05e21668c536f10c1e6d5b8a1d8c3e2b7f4a6c9d8e7f6a5b4c3d",
      got: "894fb35022b7ba6e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b",
    },
  },
];

function RejectionsComponent() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-medium">Explainable rejections</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Every denial is a receipt — the failing Datalog clause, expected vs got, one human line. The
        same shape is returned by <code className="font-mono">POST /v1/holds</code>, recorded on the
        D1 ledger, and rendered here in chat.
      </p>
      <div className="mt-6 grid gap-6">
        {BEATS.map(({ narration, receipt }) => (
          <section key={receipt.code} className="grid gap-2">
            <p className="text-xs text-muted-foreground">{narration}</p>
            <RejectionReceiptCard receipt={receipt} />
          </section>
        ))}
      </div>
    </div>
  );
}
