import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";

import {
  PublicKey,
  SignatureAlgorithm,
  generateKeyPair,
  mintRoot,
  verifySpend,
  readEnvelopeFacts,
  rootIdOf,
  capabilityChainId,
  intentDigest,
} from "@latch-protocol/core";
import * as schema from "@latch-protocol/db/schema";
import {
  hold,
  executeHold,
  getHold,
  readEnvelope,
  registerEnvelope,
  listLedger,
  type LedgerDB,
} from "@latch-protocol/db/ledger";

import { createFakeRazorpayApi, type RazorpayApi } from "./razorpay";
import { applyRazorpayEvent, hmacSha256Hex, parseRazorpayEvent, signaturesEqual, valveEvent } from "./webhook";

export interface LatchServerOptions {
  corsOrigin: string;
  /** The pinned Latch root public key ("ed25519/<hex>") capabilities are verified against. */
  rootPublicKey?: string;
  /** The D1 binding; ledger routes 503 without it. */
  db?: D1Database;
  /** Razorpay webhook secret; the webhook route fails closed without it. */
  webhookSecret?: string;
  /** Payment-API seam; defaults to the offline fake. */
  razorpay?: RazorpayApi;
}

const VerifyBody = z.object({
  token: z.string().min(1),
  merchantId: z.string().min(1),
  spot: z.number().int().nonnegative(),
  exec: z.number().int().nonnegative(),
});

const EnvelopeBody = z.object({
  rootToken: z.string().min(1),
  budgetPaise: z.number().int().positive(),
});

const ValveBody = z.object({
  holdId: z.string().min(1),
  event: z.enum(["captured", "failed", "refunded"]),
});

function noDb(): Response {
  return new Response(JSON.stringify({ error: "no database configured" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The Latch edge: stateless capability verification (crypto) + the two-phase
 * D1 ledger (the hold-gate). See ADR-0001 for the co-sign story.
 */
export function createApp(opts: LatchServerOptions) {
  const app = new Hono();

  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: opts.corsOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  // Trust anchor: the pinned root authority; everything not signed by it dies at parse.
  // toString() emits "ed25519/<hex>"; fromString wants the raw hex — accept both.
  const rootPublicKey = opts.rootPublicKey
    ? PublicKey.fromString(opts.rootPublicKey.replace(/^ed25519\//, ""), SignatureAlgorithm.Ed25519)
    : null;

  const ledger: LedgerDB | null = opts.db ? (drizzle(opts.db, { schema }) as LedgerDB) : null;
  const razorpay = opts.razorpay ?? createFakeRazorpayApi();
  const webhookSecret = opts.webhookSecret || "";

  app.get("/", (c) => c.text("OK"));

  /**
   * Boots the Biscuit WASM inside a request handler (workerd forbids module-scope
   * keygen) and proves the full mint -> verify round-trip runs at the edge.
   */
  app.get("/crypto/smoke", async (c) => {
    const { privateKey, publicKey } = generateKeyPair();
    const token = mintRoot(
      { perTxCap: 50_000, merchantId: "mer_sneakerhead", maxHops: 2, maxDeltaPct: 5 },
      privateKey,
    );
    const result = await verifySpend(
      token,
      { merchantId: "mer_sneakerhead", spot: 49_000, exec: 49_000 },
      publicKey,
    );
    return c.json({ ok: result.authorized });
  });

  /** POST /v1/verify — the stateless edge verifier. 200 when authorized, 403 with the reason. */
  app.post("/v1/verify", async (c) => {
    if (!rootPublicKey) {
      return c.json({ error: "no root public key configured" }, 503);
    }
    const parsed = VerifyBody.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
    }
    const { token, merchantId, spot, exec } = parsed.data;
    const result = await verifySpend(token, { merchantId, spot, exec }, rootPublicKey);
    if (result.authorized) return c.json({ authorized: true });
    return c.json({ authorized: false, reason: result.reason }, 403);
  });

  /**
   * POST /v1/envelopes — mint + register a per-root budget envelope.
   * Requires presenting the ROOT token itself: custody of the root key is the
   * only thing that can mint an envelope (ADR-0001; the budget is supplied
   * here — it is not in the token, which only carries the per-tx cap).
   */
  app.post("/v1/envelopes", async (c) => {
    if (!ledger) return noDb();
    if (!rootPublicKey) return c.json({ error: "no root public key configured" }, 503);

    const parsed = EnvelopeBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
    const { rootToken, budgetPaise } = parsed.data;

    const facts = await readEnvelopeFacts(rootToken, rootPublicKey);
    if (!facts) {
      return c.json({ error: "invalid-capability", message: "not a latch capability under the pinned root" }, 403);
    }
    const chain = capabilityChainId(rootToken, rootPublicKey);
    if (!chain || chain.includes(".")) {
      return c.json(
        { error: "not-a-root", message: "only root-key custody mints envelopes; attenuation cannot" },
        400,
      );
    }
    const rootId = rootIdOf(rootToken, rootPublicKey)!;
    const registered = await registerEnvelope(ledger, {
      rootId,
      merchantId: facts.merchantId,
      perTxCap: facts.perTxCap,
      maxHops: facts.maxHops,
      maxDeltaPct: facts.maxDeltaPct,
      budgetPaise,
    });
    if (registered === "exists") return c.json({ error: "envelope-exists", rootId }, 409);
    return c.json({ rootId, status: "registered", budgetPaise }, 201);
  });

  /**
   * POST /v1/holds — the co-sign. The edge verifies the capability (pure
   * crypto), then the ledger's hold-write is the atomic budget gate: replay
   * idempotent, step-up single-use, over-budget rejected with the remaining.
   */
  app.post("/v1/holds", async (c) => {
    if (!ledger) return noDb();
    if (!rootPublicKey) return c.json({ error: "no root public key configured" }, 503);

    const parsed = VerifyBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
    const { token, merchantId, spot, exec } = parsed.data;

    const verification = await verifySpend(token, { merchantId, spot, exec }, rootPublicKey);
    if (!verification.authorized) {
      return c.json({ authorized: false, reason: verification.reason }, 403);
    }

    const rootId = rootIdOf(token, rootPublicKey)!;
    // A step-up is the FULL zero-tolerance signature, not just cap == exec: a
    // plain root spending exactly at its per-tx cap must still hit the budget
    // gate. max_hops(0) + max_delta(0) + cap == committed amount is the
    // single-use envelope's fingerprint (see ADR-0001).
    const facts = await readEnvelopeFacts(token, rootPublicKey);
    const stepUp =
      facts !== null && facts.maxHops === 0 && facts.maxDeltaPct === 0 && facts.perTxCap === exec;
    const chain = capabilityChainId(token, rootPublicKey);

    const digest = await intentDigest({ merchantId, execAmount: exec });
    const outcome = await hold(ledger, {
      rootId,
      merchantId,
      intentDigest: digest,
      spotPaise: spot,
      execPaise: exec,
      stepUp,
      stepUpChainId: stepUp ? chain ?? undefined : undefined,
    });

    switch (outcome.outcome) {
      case "held": {
        const envelope = await readEnvelope(ledger, rootId);
        return c.json(
          { holdId: outcome.holdId, status: "held", stepUp, remainingPaise: envelope?.remainingPaise ?? null },
          201,
        );
      }
      case "replayed": {
        const row = await getHold(ledger, outcome.holdId);
        return c.json({ holdId: outcome.holdId, status: row?.status ?? "held", replayed: true }, 200);
      }
      case "step-up-replayed":
        return c.json(
          { error: "step-up-replayed", message: "this single-use capability was already spent" },
          409,
        );
      case "budget-exhausted":
        return c.json(
          {
            error: "budget-exhausted",
            remainingPaise: outcome.remainingPaise,
            message: `envelope budget exhausted: remaining ${outcome.remainingPaise} paise`,
          },
          402,
        );
      case "unknown-envelope":
        return c.json(
          { error: "unknown-envelope", message: "no envelope for this root — register it from root custody first" },
          404,
        );
    }
  });

  /** POST /v1/holds/:id/execute — create the payment order (API seam). */
  app.post("/v1/holds/:id/execute", async (c) => {
    if (!ledger) return noDb();
    const holdId = c.req.param("id");
    const row = await getHold(ledger, holdId);
    if (!row) return c.json({ error: "not-found", holdId }, 404);

    let orderId: string;
    try {
      const order = await razorpay.createOrder({
        amount: row.execPaise,
        currency: "INR",
        receipt: holdId,
        notes: { intent_digest: row.intentDigest, latch_hold: holdId },
      });
      orderId = order.orderId;
    } catch {
      return c.json({ error: "razorpay-order-failed", holdId }, 502);
    }

    const outcome = await executeHold(ledger, holdId, orderId);
    if (outcome.outcome === "not-found") return c.json({ error: "not-found", holdId }, 404);
    if (outcome.outcome === "terminal") {
      return c.json({ error: "hold-terminal", status: row.status }, 409);
    }
    return c.json({ holdId, status: "executed", orderId }, 200);
  });

  /**
   * POST /v1/webhooks/razorpay — the real Razorpay webhook listener.
   * HMAC-verified against the RAW body; exactly-once per x-razorpay-event-id.
   */
  app.post("/v1/webhooks/razorpay", async (c) => {
    if (!ledger) return noDb();
    if (!webhookSecret) return c.json({ error: "no-webhook-secret", message: "webhook listener fails closed without a secret" }, 503);

    const raw = await c.req.text();
    const signature = c.req.header("x-razorpay-signature");
    if (!signature) return c.json({ error: "missing-signature" }, 401);

    const expected = await hmacSha256Hex(raw, webhookSecret);
    if (!signaturesEqual(signature, expected)) return c.json({ error: "bad-signature" }, 401);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid-json" }, 400);
    }
    const evt = parseRazorpayEvent(parsed);
    if (!evt) return c.json({ error: "invalid-webhook-event" }, 400);

    const headerEventId = c.req.header("x-razorpay-event-id");
    if (headerEventId) evt.eventId = headerEventId;
    if (!evt.eventId) return c.json({ error: "missing-event-id" }, 400);

    const outcome = await applyRazorpayEvent(ledger, evt);
    return c.json({ received: true, event: evt.type, outcome: outcome.outcome });
  });

  /**
   * POST /v1/simulate/webhook — the demo valve (IDEA §5 "simulate webhook").
   * Fabricates a Razorpay-shaped event and runs it through the SAME
   * application path as the real listener, so HOLD -> CAPTURED flips on cue
   * for the film and the webhook path is genuinely exercised.
   */
  app.post("/v1/simulate/webhook", async (c) => {
    if (!ledger) return noDb();
    const parsed = ValveBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
    const { holdId, event } = parsed.data;

    const row = await getHold(ledger, holdId);
    if (!row) return c.json({ error: "not-found", holdId }, 404);

    const evt = valveEvent(row, event);
    const signature = webhookSecret ? await hmacSha256Hex(JSON.stringify(evt), webhookSecret) : null;
    const outcome = await applyRazorpayEvent(ledger, evt);
    return c.json({ simulated: true, event: evt.type, eventId: evt.eventId, outcome: outcome.outcome, signature });
  });

  /** GET /v1/envelopes/:rootId — the `remaining` read any capability may make. */
  app.get("/v1/envelopes/:rootId", async (c) => {
    if (!ledger) return noDb();
    const envelope = await readEnvelope(ledger, c.req.param("rootId"));
    if (!envelope) return c.json({ error: "not-found" }, 404);
    return c.json(envelope);
  });

  /** GET /v1/ledger — the audit view (holds lifecycle for the /ledger dashboard). */
  app.get("/v1/ledger", async (c) => {
    if (!ledger) return noDb();
    const rootId = c.req.query("rootId");
    const { holds: rows } = await listLedger(ledger, rootId);
    return c.json({ holds: rows });
  });

  return app;
}