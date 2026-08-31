# ADR-0002: Rejection receipts — one shape at every denial surface

- Status: accepted
- Date: 2026-08-31
- Ticket: [Prototype: explainable rejections — the fail-gracefully beat (#5)](https://github.com/Siddhj2206/latch-protocol/issues/5)

## Context

The buildathon's track bar requires "every money action explainable … one failure handled gracefully", and Act 3 of the film needs the tampered order to hard-fail with `❌ Intent Hash Mismatch`. Ticket #9 deferred "rejection prose" here: `verifySpend` could attribute a denial to a caveat, but only as a bare enum (`{authorized: false, reason: "IntentMismatch"}`), the HTTP surface was a 403 with no story, and a rejected money action left **no trace on the ledger** — the audit trail had a deny side nobody could read. The ticket asked what an explainable rejection looks like end-to-end: as an API error, on the ledger, in the chat UI — and how the intent-hash mismatch surfaces cleanly.

Two constraints shaped the answer: the edge verifier is **pure stateless crypto** (map #8; recording must not gate authorization), and the receipt must be honest — quote the failing check, never invent an explanation the verifier cannot prove.

## Decision

### One receipt shape, four surfaces

```ts
interface RejectionReceipt {
  code: string;      // stable machine code, e.g. "IntentMismatch"
  message: string;   // one human line: "Intent Hash Mismatch. Expected: 3f79bb7b…, Got: 894fb350…"
  clause: string;    // the failing check, VERBATIM: "check if intent($i), request_digest($d), $d == $i"
  expected: string;  // what the caveat (or gate) demanded
  got: string;       // what the presentation offered
}
```

1. **Crypto layer** — `verifySpend` rejections carry `reason` (unchanged) **and** `receipt`. `clause` quotes the envelope's Datalog check verbatim (`REJECTION_CLAUSES` in `packages/core/src/rejection.ts`); `expected`/`got` are concrete (INR-formatted amounts for money bounds, full hex digests for the intent binding — the prose line shortens digests to 12 chars). The audience binding speaks two stories, both `AudienceMismatch`: the ID-level merchant check and the optional merchant-category check (`merchant_category($c), request_category($r), $r == $c`, minted only when `caps.merchantCategory` is set) — the canonical "Merchant Category Mismatch. Expected: travel, Got: food" line, quoted with its own clause. `SignatureInvalid` quotes the ed25519 check honestly: there is no Datalog clause to blame, and the receipt says so. `AmbiguousRejection` (cold-start datalog budget exhaustion) is labelled retriable, not a rejection of the spend.
2. **API** — `POST /v1/verify` 403 and `POST /v1/holds` 403 return `{authorized, reason, receipt}`; the hold-gate denials speak the same language: `402 budget-exhausted` and `409 step-up-replayed` carry a gate receipt built by `describeGateRejection` (its `clause` names the real D1 hold-gate predicate — the SQL `spent_paise + ? <= budget_paise` bound — not invented pseudo-Datalog; the stateful twin of the datalog budget check). `step-up-replayed` now names the hold that claimed the chain (`claimedByHoldId`). An `AmbiguousRejection` — a retriable engine timeout — rides **503**, not a final 403, so machines can distinguish retry from give-up.
3. **Ledger** — a new `rejections` table (migration `0001_*`) is the audit trail's **deny side**: `recordRejection` at the hold gate stores the whole receipt plus the presentation facts (`root_id` nullable — a signature-invalid token has no trustworthy root id, and none is recorded), the amounts, and the request digest. `GET /v1/ledger` returns `{holds, rejections}` (rejections newest-first, root-filterable) — the dashboard can interleave denies with the money story. **Every denial is recorded — crypto AND gate** (`step-up-replayed`, `budget-exhausted` land rows too): recording happens only at the hold gate, the money-action boundary, best-effort so an audit-write failure never eats the caller's receipt; `/v1/verify` stays pure (no writes), so a verify-then-hold attempt is never double-counted.
4. **Chat UI** — `RejectionReceiptCard` (`packages/ui`) renders the receipt as a destructive bubble: verdict + code, headline (the message's first sentence), expected/got rows, and the failing clause as the proof block. One shape, so the card consumes the API body directly. `apps/web/routes/rejections.tsx` films the three demo beats against the exact production receipts.

### The intent-hash receipt is extractable, not guessed

The pinned `intent($i)` fact is **not datalog-queryable** on appended blocks (empirical, #9) — but Biscuit blocks are plaintext CBOR, and `getBlockSource(i)` reads a block's source once the token has signature-verified under the root key. `pinnedIntentDigest` scans block sources for the pinned digest, so `expected` on an `IntentMismatch` receipt is the **actual committed digest**, full hex — the Act 3 card shows both sides of the mismatch, not a paraphrase. The token is never parsed unverified before this read.

### Attribution soundness (cold-start guard)

A fact probe that times out (research §1.6 quirk) must never read as "fact absent": `readFact` retries once with a larger datalog budget (`queryWithLimits`). And the residual IntentMismatch path — "every root check passed in JS but authorize still failed" — is now guarded: a token with **no intent block cannot intent-mismatch**; if no pinned digest is extractable, the honest answer is `AmbiguousRejection`, not a wrong story. A flaky cold-start could otherwise have misattributed an over-cap spend as an intent mismatch (observed once during development).

## Consequences

- `VerifyResult` rejections gained a required `receipt`; the bare-enum shape is gone (callers: the edge app and tests — all updated). `reason` is retained for machine keying.
- `hold()`'s `step-up-replayed` outcome now carries `claimedByHoldId`.
- The `rejections` table is append-only and unbounded — fine for the demo; production retention is out of scope (map: production hardening).
- `/v1/ledger` response gained a `rejections` key (additive).
- The chat loop (#7) inherits the receipt: the agent's tool call can surface `receipt.message` verbatim as the chat story, and `RejectionReceiptCard` needs no transformation.

## Records

- `packages/core/src/rejection.ts` (receipt shape, `REJECTION_CLAUSES`, `describeRejection`, `describeGateRejection`, `formatInr`), `packages/core/src/index.ts` (`verifySpend` receipt wiring, merchant-category binding, `pinnedIntentDigest`, probe retry + soundness guard)
- `packages/db/src/schema/index.ts` + `0001_black_zaran.sql` (rejections table), `packages/db/src/ledger.ts` (`recordRejection`, `listRejections`, `listLedger` deny side, `claimedStepUpReplay`)
- `apps/server/src/app.ts` (receipt on 403/503/402/409, hold-gate recording of every denial, `/v1/ledger` feed)
- `packages/ui/src/components/rejection-receipt-card.tsx`, `apps/web/src/routes/rejections.tsx` (chat surface + demo beats)
- 73 tests green (34 core incl. the receipt + category + soundness suites, 16 db incl. deny-side + claim attribution, 23 server incl. recorded rejections on the HTTP seam)
