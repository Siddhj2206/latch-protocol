import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The two-phase commit ledger (see ADR-0001).
 *
 * Money movement is recorded twice: a hold row carries the lifecycle state
 * machine (held -> executed -> captured | voided), while `journal` carries the
 * double-entry DEBIT/CREDIT rows that make the ledger an audit trail.
 */

/** Per-root budget envelope: the global spend bound the whole swarm spends against. */
export const envelopes = sqliteTable("envelopes", {
  /** Root block revocation id (hex) — derived from the root token, never client-supplied. */
  rootId: text("root_id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  /** Per-transaction ceiling, paise. Read off the root token at registration. */
  perTxCap: integer("per_tx_cap").notNull(),
  maxHops: integer("max_hops").notNull(),
  maxDeltaPct: integer("max_delta_pct").notNull(),
  /** Global budget, paise. Not in the token — supplied by root-key custody at registration. */
  budgetPaise: integer("budget_paise").notNull(),
  /** Only the ledger changes spent; `remaining = budget - spent`. */
  spentPaise: integer("spent_paise").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const HOLD_STATUSES = ["held", "executed", "captured", "voided"] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

/**
 * One money action's lifecycle row. The replay key (root, intent digest, exec)
 * is the idempotency anchor: re-presenting the same capability + committed
 * spend returns the existing row instead of reserving a second time.
 */
export const holds = sqliteTable(
  "holds",
  {
    id: text("id").primaryKey(),
    /**
     * No FK to `envelopes`: step-up tokens have their own single-block root id
     * and legitimately spend with no envelope row. Envelope existence is
     * enforced at hold-write by the insert gate, not by the constraint.
     */
    rootId: text("root_id").notNull(),
    intentDigest: text("intent_digest").notNull(),
    spotPaise: integer("spot_paise").notNull(),
    execPaise: integer("exec_paise").notNull(),
    merchantId: text("merchant_id").notNull(),
    status: text("status", { enum: HOLD_STATUSES }).notNull(),
    /** Single-use (step-up) spends skip the envelope budget check but claim their capability. */
    stepUp: integer("step_up", { mode: "boolean" }).notNull().default(false),
    orderId: text("order_id"),
    paymentId: text("payment_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("holds_replay_key").on(t.rootId, t.intentDigest, t.execPaise)],
);

export const JOURNAL_ACCOUNTS = ["envelope", "escrow", "merchant"] as const;
export const JOURNAL_DIRECTIONS = ["debit", "credit"] as const;
export const JOURNAL_KINDS = ["hold", "capture", "release", "refund"] as const;

/**
 * Double-entry journal: every money movement writes two rows (one DEBIT, one
 * CREDIT) so the ledger always balances. Hold reserves envelope -> escrow;
 * capture moves escrow -> merchant on capture; release returns escrow ->
 * envelope on hold-release / payment failure; refund returns merchant ->
 * envelope on `refund.processed`.
 */
export const journal = sqliteTable("journal", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  holdId: text("hold_id")
    .notNull()
    .references(() => holds.id),
  kind: text("kind", { enum: JOURNAL_KINDS }).notNull(),
  account: text("account", { enum: JOURNAL_ACCOUNTS }).notNull(),
  direction: text("direction", { enum: JOURNAL_DIRECTIONS }).notNull(),
  amountPaise: integer("amount_paise").notNull(),
  occurredAt: integer("occurred_at").notNull(),
});

/**
 * D1-backed single-use registry (the seam #9 left): a step-up capability may
 * be claimed exactly once, atomically — the primary key IS the constraint.
 */
export const singleUseClaims = sqliteTable("single_use_claims", {
  capabilityChainId: text("capability_chain_id").primaryKey(),
  holdId: text("hold_id")
    .notNull()
    .references(() => holds.id),
  claimedAt: integer("claimed_at").notNull(),
});

/**
 * Exactly-once webhook processing: the row's primary key is Razorpay's
 * `x-razorpay-event-id`, so a duplicate delivery is a no-op.
 */
export const webhookEvents = sqliteTable("webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  /** payment_* id or refund_* id from the payload. */
  entityId: text("entity_id").notNull(),
  holdId: text("hold_id").references(() => holds.id),
  processedAt: integer("processed_at").notNull(),
});