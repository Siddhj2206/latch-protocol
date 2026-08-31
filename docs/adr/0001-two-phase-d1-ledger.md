# ADR-0001: Two-phase D1 ledger with a hold-gate — schema, idempotency, and the eventual-consistency exception

- Status: accepted
- Date: 2026-08-26
- Ticket: [Prototype: the two-phase D1 ledger + webhook capture path (#3)](https://github.com/Siddhj2206/latch-protocol/issues/3)

## Context

The map decision [#8 (stateless capabilities vs. stateful budgets)](https://github.com/Siddhj2206/latch-protocol/issues/8) settled defense-in-depth: capability auth is pure stateless crypto at the edge, and **the D1 ledger gates spend at hold-write**. Ticket #3 had to answer four questions: (1) what ledger shape makes `hold → execute → capture/void` faithful and demoable (double-entry spend rows — keyed how, token-derived?), (2) idempotency semantics, (3) the manual "simulate webhook" valve, (4) how refunds restore the agent budget — plus (5) how the edge verifier and the ledger co-sign a payment without the wallet double-spending inside D1's eventual-consistency window (IDEA §7 honest exception #1).

## Decision

### Schema (D1, drizzle, `packages/db`)

- **`envelopes`** — one row per root: `root_id` = the root block's revocation-id hex (token-derived, never client-supplied), the token's own caps read off it at registration (`readEnvelopeFacts`), plus `budget_paise` / `spent_paise`. The global budget is **not in the token** (tokens carry only per-tx caps), so registering an envelope requires presenting the **root token itself** — custody of the root key is the only thing that mints envelopes (per #8: "only root-key custody mints roots"). `remaining = budget − spent`; any root-derived capability may read it.
- **`holds`** — one row per money action's lifecycle (`held → executed → captured | voided`). Keyed by the **intent contract**: unique index on `(root_id, intent_digest, exec_paise)` — the same token + committed spend can never reserve twice. `step_up` marks fresh single-use envelopes; `order_id`/`payment_id` link Razorpay.
- **`journal`** — the double-entry rows: every money movement is a DEBIT/CREDIT pair across accounts (`envelope`, `escrow`, `merchant`). Hold: envelope debit / escrow credit. Capture: escrow debit / merchant credit. Release (void/failure): escrow debit / envelope credit. Refund: merchant debit / envelope credit. The ledger always balances; this is the audit trail the `/ledger` dashboard renders.
- **`single_use_claims`** — D1 replacement for ticket #9's in-memory `createSingleUseRegistry` (the seam's call shape is preserved; D1 is now the authority): the capability chain-id primary key IS the constraint, so a re-presented step-up can never reserve again — not even under a divergent (tampered) intent, because the hold-insert gate itself requires the chain unclaimed.
- **`webhook_events`** — primary key = Razorpay's `x-razorpay-event-id` (exactly-once processing); `entity_id` records the payload's payment/refund id the event was about.

### The hold-write is one atomic D1 batch

D1 rejects SQL `BEGIN` (session API); its atomic unit is a **batch** (all-or-nothing — a failed statement applies nothing). The whole hold is one batch of statements sharing the same gate `NOT EXISTS (replay key) AND envelope exists AND budget fits`:

1. reserve (`spent += exec` where it fits),
2. insert the hold row (0 rows on any gate miss),
3. claim the step-up chain (PK constraint),
4. insert the journal pair, gated on the hold row actually existing.

A replay or over-budget hold writes **zero rows anywhere**; the outcome is classified from the batch results + one read. Step-ups skip the envelope gate entirely — they are their own fresh bounded envelope (identified by the full zero-tolerance signature: `max_hops(0)` + `max_delta(0)` + cap == committed amount, so a plain root spending exactly at its per-tx cap still hits the budget gate; single-use claim), never an overdraw, per #8.

Capture/void/refund are the same shape: the webhook-event row, the status-guarded update (`held|executed → captured`; `held|executed → voided`; `captured → voided`), the budget restore (void/refund only, `max(spent − exec, 0)`), and the journal pair — one batch, so a duplicate event or a transition on a terminal hold aborts atomically.

### Idempotency semantics

- **Hold replay** — same `(root, intent digest, exec)` → returns the existing hold, never a second reservation. Distinct intents are distinct holds.
- **Step-up replay** — same capability chain → `step-up-replayed` (409).
- **Webhook delivery** — duplicate `x-razorpay-event-id` → no-op; out-of-order events are absorbed by status guards; retries after failure are always safe.
- **Razorpay side** — the order `receipt` IS the hold id (Razorpay's documented idempotency key, research ¶2).

### The simulate-webhook valve

`POST /v1/simulate/webhook` fabricates a Razorpay-shaped event (deterministic ids: repeat invocation = duplicate = no-op) and runs it through the **same application path** as the real listener — the ledger transitions are byte-for-byte identical; only the HMAC/HTTP transport is skipped. The HOLD→CAPTURED flip in the film is the webhook handler itself, fed by a fabricated event.

Known gap (deferred seams): the payment-initiation and `payment.authorized → POST /v1/payments/:id/capture` legs are not built — in a live test-mode run CAPTURED arrives organically when an order paid via checkout/API is manually captured, but the S2S `initiate_payment`/OTP flow belongs to the agent-loop ticket (#7).

### Co-signing

Auth and spend are two independent gates, defense-in-depth:

- the **edge verifier** is pure token math (signature, caveats, intent hash) — no database;
- the **hold-write** is the second signature: an atomic budget check that makes replay, over-spend, and step-up reuse impossible **within one D1 region**.

### Honest exception (IDEA §7.1, accepted)

Cloudflare D1 is eventually consistent across regions. Two geographically distant writers racing on the same envelope could both observe the budget before replication propagates (~100 ms window) and both pass the gate. The demo runs one primary region, the batch serializes writes locally, and the window is documented — not engineered away.

## Consequences

- Holds are the only writers of `spent`; `verifySpend` stays a pure function (the #9 contract is untouched).
- `holds.root_id` deliberately has **no FK** to `envelopes`: a step-up token's single block carries its own revocation id and legitimately holds with no envelope row; envelope existence for auto spends is enforced by the insert gate.
- The D1 `single_use_claims` table is now the authority for step-up reuse; the #9 in-memory registry remains only as a non-persistent convenience (its tests keep it honest).
- Explainable rejections flow as structured HTTP (`402 budget-exhausted` with `remainingPaise`, `403` with the crypto reason, `409` step-up/created, `404` unknown-envelope) — the fail-gracefully beat graduates to ticket #5.

## Records

- `packages/db/src/schema/index.ts` + `0000_*.sql` migration
- `packages/db/src/ledger.ts` (hold/execute/capture/void/refund/register/read)
- `apps/server/src/app.ts` (routes), `razorpay.ts` (Razorpay API seam), `webhook.ts` (HMAC + shared handler + valve)
- 56 tests green (21 core, 14 ledger-on-Miniflare-D1, 21 HTTP seam)
