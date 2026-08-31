/**
 * The rejection receipt (issue #5, "explainable rejections"): the story a
 * denial tells at every surface. One shape —
 *
 *   { code, message, clause, expected, got }
 *
 * — rendered as the API error body, a ledger row, and a chat card. `clause`
 * quotes the failing Datalog check verbatim from the envelope; `expected` /
 * `got` make the mismatch concrete; `message` is the single human line in the
 * CONTEXT.md shape ("Merchant Category Mismatch. Expected: travel, Got: food").
 * A rejection is a story, not a 403.
 */

export type RejectionReason =
  | "AmountCapExceeded"
  | "SlippageExceeded"
  | "AudienceMismatch"
  | "DelegationDepthExceeded"
  | "IntentMismatch"
  | "SignatureInvalid"
  | "AmbiguousRejection";

/**
 * The audience binding speaks two stories: the merchant-id check (ID-level,
 * the hard security bound) and the merchant-category check (the canonical
 * explainable-rejection story — "Merchant Category Mismatch. Expected: travel,
 * Got: food" — CONTEXT.md). Both are AudienceMismatch; the receipt's clause
 * and message name the check that actually failed.
 */

/**
 * The ledger's hold-gate speaks the same receipt language as the crypto layer:
 * its two denials (budget exhausted, step-up replay) are rejections too.
 */
export type RejectionCode = RejectionReason | "BudgetExhausted" | "StepUpReplayed";

export interface RejectionReceipt {
  /** Stable machine code — keys the chat card and the ledger filter. */
  code: RejectionCode;
  /** The single human line: what failed, expected vs got. */
  message: string;
  /** The failing check, verbatim: a Datalog caveat, or the gate predicate. */
  clause: string;
  /** What the caveat (or gate) demanded. */
  expected: string;
  /** What the presentation actually offered. */
  got: string;
}

/** The envelope's caveat checks, quoted verbatim in receipts. */
export const REJECTION_CLAUSES = {
  amountCap: "check if amount_cap($c), spot($s), $s <= $c",
  audience: "check if merchant($m), request_merchant($r), $r == $m",
  merchantCategory: "check if merchant_category($c), request_category($r), $r == $c",
  depth: "check if max_hops($h), hops($n), $n <= $h",
  slippage: "check if max_delta($d), spot($s), exec($e), $e <= $s + ($s * $d / 100)",
  intent: "check if intent($i), request_digest($d), $d == $i",
} as const;

/** Paise → "₹490.00" — receipts talk money, not raw integers. */
export function formatInr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** A 64-hex digest truncated for prose: first 12 chars + ellipsis. */
function shortDigest(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 12)}…` : hex;
}

/** The facts a rejection story needs, gathered by the verifier. */
export interface RejectionContext {
  spot: number;
  exec: number;
  /** The merchant the spend was presented at (the "Got" of an audience mismatch). */
  presentedMerchantId?: string;
  /** The merchant category the spend was presented under (the "Got" of a category mismatch). */
  presentedMerchantCategory?: string;
  /** Appended blocks beyond the root. */
  hops?: number;
  /** The digest computed over THIS request (always available). */
  requestDigest?: string;
  /** The digest pinned by the capability's intent block (delegations, step-ups). */
  intentDigest?: string;
  /** The envelope bounds read off the token (null when it failed to parse). */
  bound?: {
    perTxCap?: number;
    /** The merchant the capability is bound to (the "Expected" side). */
    merchantId?: string;
    /** The merchant category the capability is bound to (the "Expected" side). */
    merchantCategory?: string;
    maxHops?: number;
    maxDeltaPct?: number;
  };
}

export function describeRejection(reason: RejectionReason, ctx: RejectionContext): RejectionReceipt {
  switch (reason) {
    case "AmountCapExceeded": {
      const cap = ctx.bound?.perTxCap ?? 0;
      return {
        code: reason,
        message: `Per-Transaction Cap Exceeded. Expected: at most ${formatInr(cap)}, Got: ${formatInr(ctx.spot)} (committed spot)`,
        clause: REJECTION_CLAUSES.amountCap,
        expected: `at most ${formatInr(cap)}`,
        got: `${formatInr(ctx.spot)} (committed spot)`,
      };
    }
    case "AudienceMismatch": {
      // The canonical story (CONTEXT.md): name the category checks first — a
      // category-bound capability reports "Merchant Category Mismatch", the
      // ID-level binding falls back to "Merchant Mismatch".
      const boundCategory = ctx.bound?.merchantCategory;
      if (boundCategory !== undefined && ctx.presentedMerchantCategory !== boundCategory) {
        return {
          code: reason,
          message: `Merchant Category Mismatch. Expected: ${boundCategory}, Got: ${ctx.presentedMerchantCategory ?? "(none offered)"}`,
          clause: REJECTION_CLAUSES.merchantCategory,
          expected: boundCategory,
          got: ctx.presentedMerchantCategory ?? "(none offered)",
        };
      }
      const bound = ctx.bound?.merchantId ?? "(unknown)";
      return {
        code: reason,
        message: `Merchant Mismatch. Expected: ${bound}, Got: ${ctx.presentedMerchantId ?? "(unknown)"}`,
        clause: REJECTION_CLAUSES.audience,
        expected: bound,
        got: ctx.presentedMerchantId ?? "(unknown)",
      };
    }
    case "SlippageExceeded": {
      const delta = ctx.bound?.maxDeltaPct ?? 0;
      const allowance = ctx.spot + Math.floor((ctx.spot * delta) / 100);
      return {
        code: reason,
        message: `Slippage Exceeded. Expected: at most ${formatInr(allowance)} (${formatInr(ctx.spot)} spot + ${delta}% allowance), Got: ${formatInr(ctx.exec)}`,
        clause: REJECTION_CLAUSES.slippage,
        expected: `at most ${formatInr(allowance)} (${formatInr(ctx.spot)} spot + ${delta}% allowance)`,
        got: formatInr(ctx.exec),
      };
    }
    case "DelegationDepthExceeded": {
      const maxHops = ctx.bound?.maxHops ?? 0;
      return {
        code: reason,
        message: `Delegation Depth Exceeded. Expected: at most ${maxHops} delegation hops, Got: ${ctx.hops ?? "(unknown)"}`,
        clause: REJECTION_CLAUSES.depth,
        expected: `at most ${maxHops} delegation hops`,
        got: `${ctx.hops ?? "(unknown)"}`,
      };
    }
    case "IntentMismatch": {
      const pinned = ctx.intentDigest ?? "(unknown)";
      const computed = ctx.requestDigest ?? "(unknown)";
      return {
        code: reason,
        message: `Intent Hash Mismatch. Expected: ${shortDigest(pinned)} (the committed spend), Got: ${shortDigest(computed)} (this request)`,
        clause: REJECTION_CLAUSES.intent,
        expected: pinned,
        got: computed,
      };
    }
    case "SignatureInvalid":
      return {
        code: reason,
        message:
          "Signature Invalid. Expected: a capability signed under the pinned root authority, Got: a token whose signature does not verify",
        clause: "ed25519 signature over the capability block chain (the pinned root key)",
        expected: "a capability signed under the pinned root authority",
        got: "a token whose signature does not verify",
      };
    case "AmbiguousRejection":
      return {
        code: reason,
        message:
          "Datalog Proof Budget Exhausted. The proof engine hit its time budget mid-check (cold-start quirk) — retriable, not a rejection of the spend itself.",
        clause: "(the datalog engine exhausted its budget before any clause could be blamed)",
        expected: "a proof within the engine's time budget",
        got: "a timeout (retriable)",
      };
  }
}

/** The ledger hold-gate's denials, in receipt form. */
export function describeGateRejection(
  code: "BudgetExhausted" | "StepUpReplayed",
  ctx: { execPaise: number; remainingPaise?: number; claimedByHoldId?: string },
): RejectionReceipt {
  if (code === "BudgetExhausted") {
    const remaining = ctx.remainingPaise ?? 0;
    return {
      code,
      message: `Envelope Budget Exhausted. Expected: a spend within the ${formatInr(remaining)} remaining, Got: a ${formatInr(ctx.execPaise)} hold`,
      // The REAL gate predicate, named honestly (ADR-0002's "names the D1
      // hold-gate predicate") — it is SQL, not Datalog, and the receipt says so.
      clause: "envelopes budget gate (D1 SQL): spent_paise + ? <= budget_paise AND root_id = ?",
      expected: `a spend within the ${formatInr(remaining)} remaining`,
      got: `a ${formatInr(ctx.execPaise)} hold`,
    };
  }
  return {
    code,
    message: `Single-Use Capability Already Spent. Expected: an unclaimed step-up, Got: a capability whose chain was already claimed${ctx.claimedByHoldId ? ` by ${ctx.claimedByHoldId}` : ""}`,
    clause: "single_use_claims.capability_chain_id PRIMARY KEY — held by the D1 hold-gate",
    expected: "an unclaimed step-up",
    got: `a capability whose chain was already claimed${ctx.claimedByHoldId ? ` by ${ctx.claimedByHoldId}` : ""}`,
  };
}
