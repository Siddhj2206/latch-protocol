import { and, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { RejectionReceipt } from "@latch-protocol/core";

import * as schema from "./schema";
import { holds, envelopes, singleUseClaims, rejections } from "./schema";

export type LedgerDB = DrizzleD1Database<typeof schema>;
export type HoldRow = typeof holds.$inferSelect;
export type EnvelopeRow = typeof envelopes.$inferSelect;

/**
 * Table names are written in the raw SQL below; they live in the drizzle
 * schema (`schema/index.ts`) and its generated migration. The raw statements
 * are the ONLY place they're spelled by hand.
 */
const T = {
  envelopes: "envelopes",
  holds: "holds",
  journal: "journal",
  claims: "single_use_claims",
  events: "webhook_events",
};

export interface HoldInput {
  rootId: string;
  merchantId: string;
  intentDigest: string;
  spotPaise: number;
  execPaise: number;
  /** Present for step-up spends: the capability chain is claimed exactly once. */
  stepUp?: boolean;
  stepUpChainId?: string;
}

export type HoldOutcome =
  | { outcome: "held"; holdId: string }
  | { outcome: "replayed"; holdId: string }
  | { outcome: "step-up-replayed"; claimedByHoldId?: string }
  | { outcome: "budget-exhausted"; remainingPaise: number }
  | { outcome: "unknown-envelope" };

export type TransitionInput = {
  holdId: string;
  /** Razorpay `x-razorpay-event-id` — the exactly-once anchor. */
  eventId: string;
  eventType: string;
  /** The payload's entity id (payment or refund id) the event is about. */
  entityId: string;
};

export type TransitionOutcome =
  | { outcome: "captured" }
  | { outcome: "voided" }
  | { outcome: "executed"; orderId: string }
  | { outcome: "duplicate" }
  | { outcome: "not-found" }
  | { outcome: "terminal" };

type Param = string | number;

function now(): number {
  return Date.now();
}

/** The raw D1 binding underneath drizzle — the atomic `batch()` lives there. */
function raw(db: LedgerDB): D1Database {
  return (db as unknown as { $client: D1Database }).$client;
}

function stmt(db: LedgerDB, sql: string, ...params: Param[]) {
  return raw(db)
    .prepare(sql)
    .bind(...params);
}

/** Every gated write shares this predicate: the intent key already on file? */
function replayGateSql(): string {
  return `NOT EXISTS (
    SELECT 1 FROM ${T.holds} h
    WHERE h.root_id = ? AND h.intent_digest = ? AND h.exec_paise = ?
  )`;
}

/** The one place the replay key predicate is spelled; both reads use it. */
async function findReplay(
  db: LedgerDB,
  input: Pick<HoldInput, "rootId" | "intentDigest" | "execPaise">,
): Promise<HoldRow | undefined> {
  return db
    .select()
    .from(holds)
    .where(
      and(
        eq(holds.rootId, input.rootId),
        eq(holds.intentDigest, input.intentDigest),
        eq(holds.execPaise, input.execPaise),
      ),
    )
    .get();
}

/**
 * HOLD — the atomic budget gate (ADR-0001).
 *
 * D1's atomic unit is a BATCH of prepared statements (all-or-nothing; a failed
 * statement applies nothing — SQL-level BEGIN is rejected by the session API).
 * So the whole hold is ONE batch of statements that all carry the SAME gate:
 *
 *   NOT EXISTS (replay key) AND envelope exists AND (step-up OR budget fits)
 *
 * - a replay or an over-budget hold writes ZERO rows anywhere (nothing to
 *   un-write), and the outcome is classified from the batch results + one
 *   follow-up read;
 * - a step-up additionally claims its capability chain id inside the batch —
 *   the primary key IS the constraint, so a re-presented step-up can never
 *   reserve again;
 * - the double-entry journal pair is gated on the hold row actually existing
 *   (`EXISTS (SELECT 1 FROM holds WHERE id = ...)`), which is true only when
 *   the hold insertion landed earlier in the same batch.
 *
 * The edge verifier authorizes the token; this write is the second signature —
 * the copy of truth that makes a replayed or over-budget spend impossible
 * within one D1 region. Cross-region eventual consistency is IDEA §7.1,
 * recorded in ADR-0001.
 */
export async function hold(db: LedgerDB, input: HoldInput): Promise<HoldOutcome> {
  const existing = await findReplay(db, input);
  if (existing) {
    // Same capability re-presented: if it carries a single-use chain, the precise
    // story is "this step-up was already spent", not a generic replay.
    const replayed = await claimedStepUpReplay(db, input);
    if (replayed) return replayed;
    return { outcome: "replayed", holdId: existing.id };
  }

  const holdId = `hold_${crypto.randomUUID()}`;
  const t = now();
  const replayArgs: Param[] = [input.rootId, input.intentDigest, input.execPaise];
  // Step-ups are their own fresh single-use envelope (ADR-0001): no global
  // budget row exists for them, so the budget/existence gate is skipped — but
  // the single-use claim gate is NOT: the same capability chain must never
  // reserve twice, even under a divergent (tampered) intent.
  const envelopeGate = input.stepUp
    ? "NOT EXISTS (SELECT 1 FROM single_use_claims c WHERE c.capability_chain_id = ?)"
    : "EXISTS (SELECT 1 FROM envelopes e WHERE e.root_id = ? AND e.spent_paise + ? <= e.budget_paise)";
  const envelopeArgs: Param[] = input.stepUp
    ? [input.stepUpChainId ?? ""]
    : [input.rootId, input.execPaise];

  const results = await raw(db).batch([
    // 1. Reserve budget (skipped for step-up: its bound is the single-use claim).
    stmt(
      db,
      `UPDATE ${T.envelopes} SET spent_paise = spent_paise + ?
       WHERE root_id = ? AND spent_paise + ? <= budget_paise AND ${replayGateSql()}`,
      input.execPaise,
      input.rootId,
      input.execPaise,
      ...replayArgs,
    ),
    // 2. The hold row itself — gated so a replay/over-budget/claimed-capability
    //    hold writes nothing. The claim is NOT yet inserted at this point, so a
    //    first-time step-up passes; a claimed chain blocks here.
    stmt(
      db,
      `INSERT INTO ${T.holds}
         (id, root_id, intent_digest, spot_paise, exec_paise, merchant_id, status, step_up, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 'held', ?, ?, ?
       WHERE ${replayGateSql()} AND ${envelopeGate}`,
      holdId,
      input.rootId,
      input.intentDigest,
      input.spotPaise,
      input.execPaise,
      input.merchantId,
      input.stepUp ? 1 : 0,
      t,
      t,
      ...replayArgs,
      ...envelopeArgs,
    ),
    // 3. Step-up single-use claim — lands only when the hold actually landed
    //    (the primary key IS the constraint).
    ...(input.stepUp && input.stepUpChainId
      ? [
          stmt(
            db,
            `INSERT INTO ${T.claims} (capability_chain_id, hold_id, claimed_at)
             SELECT ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM ${T.holds} h WHERE h.id = ?)`,
            input.stepUpChainId,
            holdId,
            t,
            holdId,
          ),
        ]
      : []),
    // 4. Double-entry pair — envelope debit / escrow credit, gated on the hold.
    stmt(
      db,
      `INSERT INTO ${T.journal} (hold_id, kind, account, direction, amount_paise, occurred_at)
       SELECT ?, 'hold', 'envelope', 'debit', ?, ?
       WHERE EXISTS (SELECT 1 FROM ${T.holds} h WHERE h.id = ?)`,
      holdId,
      input.execPaise,
      t,
      holdId,
    ),
    stmt(
      db,
      `INSERT INTO ${T.journal} (hold_id, kind, account, direction, amount_paise, occurred_at)
       SELECT ?, 'hold', 'escrow', 'credit', ?, ?
       WHERE EXISTS (SELECT 1 FROM ${T.holds} h WHERE h.id = ?)`,
      holdId,
      input.execPaise,
      t,
      holdId,
    ),
  ]);

  const inserted = results[1]!.meta.changes;
  if (inserted === 1) return { outcome: "held", holdId };

  // Nothing was written (the batch is atomic): classify why.
  const replay = await findReplay(db, input);
  if (replay) {
    const replayed = await claimedStepUpReplay(db, input);
    if (replayed) return replayed;
    return { outcome: "replayed", holdId: replay.id };
  }

  const replayed = await claimedStepUpReplay(db, input);
  if (replayed) return replayed;

  const envelope = await db
    .select()
    .from(envelopes)
    .where(eq(envelopes.rootId, input.rootId))
    .get();
  if (!envelope) return { outcome: "unknown-envelope" };
  return {
    outcome: "budget-exhausted",
    remainingPaise: envelope.budgetPaise - envelope.spentPaise,
  };
}

async function claimRow(db: LedgerDB, capabilityChainId: string) {
  return db
    .select()
    .from(singleUseClaims)
    .where(eq(singleUseClaims.capabilityChainId, capabilityChainId))
    .get();
}

/**
 * The one place "was this step-up already spent?" is classified (ADR-0002):
 * a re-presented single-use capability names the hold that claimed its chain.
 * Returns null when the capability isn't a step-up or nothing claims it yet.
 */
async function claimedStepUpReplay(
  db: LedgerDB,
  input: Pick<HoldInput, "stepUp" | "stepUpChainId">,
): Promise<HoldOutcome | null> {
  if (!input.stepUp || !input.stepUpChainId) return null;
  const claimed = await claimRow(db, input.stepUpChainId);
  return claimed ? { outcome: "step-up-replayed", claimedByHoldId: claimed.holdId } : null;
}

/**
 * EXECUTE — call the payment API (via the gateway seam) and record the order.
 * Money has not moved; the ledger just learns the order id (receipt = hold id,
 * Razorpay's own idempotency key).
 */
export async function executeHold(
  db: LedgerDB,
  holdId: string,
  orderId: string,
): Promise<TransitionOutcome> {
  const result = await db
    .update(holds)
    .set({ status: "executed", orderId, updatedAt: now() })
    .where(and(eq(holds.id, holdId), eq(holds.status, "held")))
    .run();
  if ((result as unknown as { meta: { changes: number } }).meta.changes === 1) {
    return { outcome: "executed", orderId };
  }

  const row = await db.select().from(holds).where(eq(holds.id, holdId)).get();
  if (!row) return { outcome: "not-found" };
  // Already executed: a retry is a benign idempotent success, not an error.
  if (row.status === "executed") return { outcome: "executed", orderId: row.orderId ?? orderId };
  return { outcome: "terminal" };
}

/**
 * Settle a hold from a webhook event. Exactly-once per `eventId`: the event
 * row and the state change live in ONE atomic batch, so a duplicate delivery
 * aborts the whole batch and can never double-process.
 */
async function settleWithEvent(
  db: LedgerDB,
  input: TransitionInput,
  to: "captured" | "voided",
  transition: () => string[],
  transitionParams: (t: number) => Param[][],
  journalPair: { kind: "hold" | "capture" | "release" | "refund"; debit: string; credit: string },
): Promise<TransitionOutcome> {
  const t = now();
  const transitionSql = transition();
  const transitionParamsList = transitionParams(t);

  const batch = [
    // The event row up front: its PK collision is what makes duplicates no-ops.
    stmt(
      db,
      `INSERT INTO ${T.events} (event_id, event_type, entity_id, hold_id, processed_at)
       VALUES (?, ?, ?, ?, ?)`,
      input.eventId,
      input.eventType,
      input.entityId,
      input.holdId,
      t,
    ),
  ];
  transitionSql.forEach((sql, i) => batch.push(stmt(db, sql, ...transitionParamsList[i]!)));
  // The journal pair only lands if the state actually changed, earlier in this batch.
  batch.push(
    stmt(
      db,
      `INSERT INTO ${T.journal} (hold_id, kind, account, direction, amount_paise, occurred_at)
       SELECT ?, ?, ?, 'debit', h.exec_paise, ?
       FROM ${T.holds} h WHERE h.id = ? AND h.status = ?`,
      input.holdId,
      journalPair.kind,
      journalPair.debit,
      t,
      input.holdId,
      to,
    ),
    stmt(
      db,
      `INSERT INTO ${T.journal} (hold_id, kind, account, direction, amount_paise, occurred_at)
       SELECT ?, ?, ?, 'credit', h.exec_paise, ?
       FROM ${T.holds} h WHERE h.id = ? AND h.status = ?`,
      input.holdId,
      journalPair.kind,
      journalPair.credit,
      t,
      input.holdId,
      to,
    ),
  );

  let results: D1Result[];
  try {
    results = await raw(db).batch(batch);
  } catch (e) {
    const message = String(e);
    // A duplicate delivery collides on the event PK; a missing hold trips the
    // event row's FK. Both abort the whole atomic batch — nothing was applied.
    if (message.includes("UNIQUE constraint failed")) return { outcome: "duplicate" };
    if (message.includes("FOREIGN KEY constraint failed")) return { outcome: "not-found" };
    throw e;
  }

  if (results[1]!.meta.changes === 0) {
    const row = await db.select().from(holds).where(eq(holds.id, input.holdId)).get();
    if (!row) return { outcome: "not-found" };
    return { outcome: "terminal" };
  }
  return { outcome: to };
}

/**
 * The status guard each transition applies, and the budget-restore that must
 * accompany voids/refunds (only when the void actually landed).
 */
function statusGuard(from: string): string {
  return `UPDATE ${T.holds} SET status = 'voided', updated_at = ?
          WHERE id = ? AND status IN (${from})`;
}

const RESTORE = `UPDATE ${T.envelopes}
  SET spent_paise = max(spent_paise - h.exec_paise, 0)
  FROM ${T.holds} h
  WHERE h.id = ? AND h.status = 'voided' AND ${T.envelopes}.root_id = h.root_id`;

/**
 * CAPTURE — `payment.captured`. Budget stays spent (reserved at hold); escrow
 * settles to merchant.
 */
export async function capture(
  db: LedgerDB,
  input: TransitionInput & { paymentId: string },
): Promise<TransitionOutcome> {
  return settleWithEvent(
    db,
    input,
    "captured",
    () => [
      `UPDATE ${T.holds} SET status = 'captured', payment_id = ?, updated_at = ?
       WHERE id = ? AND status IN ('held', 'executed')`,
    ],
    (t) => [[input.paymentId, t, input.holdId]],
    { kind: "capture", debit: "escrow", credit: "merchant" },
  );
}

/**
 * VOID — `payment.failed` or a manual hold-release. Escrow returns to the
 * envelope; the agent's budget is restored instantly.
 */
export async function voidHold(db: LedgerDB, input: TransitionInput): Promise<TransitionOutcome> {
  return settleWithEvent(
    db,
    input,
    "voided",
    () => [statusGuard("'held', 'executed'"), RESTORE],
    (t) => [[t, input.holdId], [input.holdId]],
    { kind: "release", debit: "escrow", credit: "envelope" },
  );
}

/**
 * REFUND — `refund.processed` on a captured payment. Merchant settles back to
 * the envelope: the demo's "refunds restore the agent budget" beat.
 */
export async function refund(db: LedgerDB, input: TransitionInput): Promise<TransitionOutcome> {
  return settleWithEvent(
    db,
    input,
    "voided",
    () => [statusGuard("'captured'"), RESTORE],
    (t) => [[t, input.holdId], [input.holdId]],
    { kind: "refund", debit: "merchant", credit: "envelope" },
  );
}

/** Read one hold by id — the ledger owns its own table's lookups. */
export async function getHold(db: LedgerDB, holdId: string): Promise<HoldRow | null> {
  const row = await db.select().from(holds).where(eq(holds.id, holdId)).get();
  return row ?? null;
}

/** The envelope read any root-derived capability may perform: remaining budget. */
export async function readEnvelope(
  db: LedgerDB,
  rootId: string,
): Promise<(EnvelopeRow & { remainingPaise: number }) | null> {
  const row = await db.select().from(envelopes).where(eq(envelopes.rootId, rootId)).get();
  if (!row) return null;
  return { ...row, remainingPaise: row.budgetPaise - row.spentPaise };
}

export async function registerEnvelope(
  db: LedgerDB,
  input: {
    rootId: string;
    merchantId: string;
    perTxCap: number;
    maxHops: number;
    maxDeltaPct: number;
    budgetPaise: number;
  },
): Promise<"registered" | "exists"> {
  const existing = await db
    .select()
    .from(envelopes)
    .where(eq(envelopes.rootId, input.rootId))
    .get();
  if (existing) return "exists";
  await db.insert(envelopes).values({ ...input, spentPaise: 0, createdAt: now() });
  return "registered";
}

/** The audit view for the /ledger dashboard: holds, newest first. */
export async function listLedger(db: LedgerDB, rootId?: string) {
  const where = rootId ? eq(holds.rootId, rootId) : undefined;
  const holdRows = await db.select().from(holds).where(where).orderBy(holds.createdAt).all();
  return { holds: holdRows, rejections: await listRejections(db, rootId) };
}

/**
 * Record a rejection receipt (issue #5): the deny side of the audit trail,
 * written at the hold gate — the money-action boundary. Returns the receipt id.
 */
export async function recordRejection(db: LedgerDB, input: RejectionInput): Promise<string> {
  const id = `rej_${crypto.randomUUID()}`;
  await db.insert(rejections).values({
    id,
    code: input.receipt.code,
    message: input.receipt.message,
    clause: input.receipt.clause,
    expected: input.receipt.expected,
    got: input.receipt.got,
    rootId: input.rootId ?? null,
    merchantId: input.merchantId,
    spotPaise: input.spotPaise,
    execPaise: input.execPaise,
    requestDigest: input.requestDigest,
    createdAt: now(),
  });
  return id;
}

export interface RejectionInput {
  /** The receipt that was returned to the caller — the one core shape, no drifted copy. */
  receipt: RejectionReceipt;
  /** Null for a signature-invalid token: no trustworthy root id exists. */
  rootId?: string;
  merchantId: string;
  spotPaise: number;
  execPaise: number;
  requestDigest: string;
}

/** The denial feed for the ledger dashboard, newest first. */
export async function listRejections(db: LedgerDB, rootId?: string) {
  const where = rootId ? eq(rejections.rootId, rootId) : undefined;
  return db.select().from(rejections).where(where).orderBy(desc(rejections.createdAt)).all();
}
