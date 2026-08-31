import { eq, or } from "drizzle-orm";

import { bytesToHex } from "@latch-protocol/core";
import { holds } from "@latch-protocol/db/schema";
import {
  capture,
  refund,
  voidHold,
  type HoldRow,
  type LedgerDB,
  type TransitionOutcome,
} from "@latch-protocol/db/ledger";

/**
 * Razorpay webhook handling (research ¶4).
 *
 * - Signature: `X-Razorpay-Signature` = hex(HMAC-SHA256(raw_body, secret)).
 *   The body must be verified RAW — never re-serialized.
 * - Exactly-once: the ledger keys every transition on `x-razorpay-event-id`
 *   (the `webhook_events` PK); duplicates abort the atomic batch as no-ops.
 * - Resolution: `payment.captured`/`payment.failed` events carry the order the
 *   payment was made against — the ledger resolves the hold by order id, then
 *   by payment id. `refund.processed` carries only the payment id.
 */

export type RazorpayEventType = "payment.captured" | "payment.failed" | "refund.processed";

export interface ParsedRazorpayEvent {
  eventId: string;
  type: RazorpayEventType;
  orderId?: string;
  paymentId?: string;
  refundPaymentId?: string;
}

/** Flatten a Razorpay webhook body (supports the real nested `payload.*.entity` shape). */
export function parseRazorpayEvent(body: unknown): ParsedRazorpayEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as {
    event?: unknown;
    id?: unknown;
    payload?: {
      payment?: { entity?: unknown; id?: unknown; order_id?: unknown };
      refund?: { entity?: unknown; payment_id?: unknown };
    };
  };
  const type = b.event;
  if (type !== "payment.captured" && type !== "payment.failed" && type !== "refund.processed") {
    return null;
  }

  const paymentEntity = (): Partial<{ id: string; order_id: string }> => {
    const p = b.payload?.payment;
    if (!p) return {};
    const e = p.entity;
    if (e !== null && typeof e === "object") return e as Partial<{ id: string; order_id: string }>;
    return {
      id: typeof p.id === "string" ? p.id : undefined,
      order_id: typeof p.order_id === "string" ? p.order_id : undefined,
    };
  };
  const refundEntity = (): Partial<{ id: string; payment_id: string }> => {
    const r = b.payload?.refund;
    if (!r) return {};
    const e = r.entity;
    if (e !== null && typeof e === "object")
      return e as Partial<{ id: string; payment_id: string }>;
    return { payment_id: typeof r.payment_id === "string" ? r.payment_id : undefined };
  };

  const payment = paymentEntity();
  const refundData = refundEntity();
  return {
    eventId: typeof b.id === "string" ? b.id : "",
    type,
    orderId: payment.order_id,
    paymentId: payment.id,
    refundPaymentId: refundData.payment_id,
  };
}

async function resolveHold(db: LedgerDB, evt: ParsedRazorpayEvent): Promise<HoldRow | null> {
  const clauses = [];
  if (evt.orderId) clauses.push(eq(holds.orderId, evt.orderId));
  if (evt.paymentId) clauses.push(eq(holds.paymentId, evt.paymentId));
  if (evt.refundPaymentId) clauses.push(eq(holds.paymentId, evt.refundPaymentId));
  if (clauses.length === 0) return null;

  const row = await db
    .select()
    .from(holds)
    .where(or(...clauses))
    .get();
  return row ?? null;
}

export type WebhookApplyOutcome =
  | TransitionOutcome
  | { outcome: "ignored" }
  | { outcome: "not-found" };

/**
 * The shared webhook application path — the REAL route runs it after HMAC
 * verification; the simulate valve runs it with a fabricated event. The ledger
 * transitions are byte-for-byte the same either way.
 */
export async function applyRazorpayEvent(
  db: LedgerDB,
  evt: ParsedRazorpayEvent,
): Promise<WebhookApplyOutcome> {
  switch (evt.type) {
    case "payment.captured": {
      const hold = await resolveHold(db, evt);
      if (!hold || !evt.paymentId) return { outcome: "not-found" };
      const outcome = await capture(db, {
        holdId: hold.id,
        eventId: evt.eventId,
        eventType: evt.type,
        entityId: evt.paymentId,
        paymentId: evt.paymentId,
      });
      return outcome;
    }
    case "payment.failed": {
      const hold = await resolveHold(db, evt);
      if (!hold || !evt.paymentId) return { outcome: "not-found" };
      const outcome = await voidHold(db, {
        holdId: hold.id,
        eventId: evt.eventId,
        eventType: evt.type,
        entityId: evt.paymentId,
      });
      return outcome;
    }
    case "refund.processed": {
      const hold = await resolveHold(db, evt);
      if (!hold || !evt.refundPaymentId) return { outcome: "not-found" };
      const outcome = await refund(db, {
        holdId: hold.id,
        eventId: evt.eventId,
        eventType: evt.type,
        entityId: evt.refundPaymentId,
      });
      return outcome;
    }
  }
}

/** hex(HMAC-SHA256(message, secret)) — the Razorpay webhook signature scheme. */
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

/** Constant-time hex comparison (length leaks only, which is public anyway). */
export function signaturesEqual(received: string, expected: string): boolean {
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < received.length; i++) diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Deterministic synthetic event for the simulate valve — repeats are duplicates. */
export function valveEvent(
  hold: HoldRow,
  kind: "captured" | "failed" | "refunded",
): ParsedRazorpayEvent {
  const paymentId = `pay_valve_${hold.id}`;
  switch (kind) {
    case "captured":
      return {
        eventId: `evt_valve_${hold.id}_captured`,
        type: "payment.captured",
        orderId: hold.orderId ?? `order_valve_${hold.id}`,
        paymentId,
      };
    case "failed":
      return {
        eventId: `evt_valve_${hold.id}_failed`,
        type: "payment.failed",
        orderId: hold.orderId ?? `order_valve_${hold.id}`,
        paymentId,
      };
    case "refunded":
      return {
        eventId: `evt_valve_${hold.id}_refunded`,
        type: "refund.processed",
        refundPaymentId: hold.paymentId ?? paymentId,
      };
  }
}
